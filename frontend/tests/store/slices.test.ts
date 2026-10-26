import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { dispatchRawFrame, localSource, registerLocalEngine } from "../../lib/generation";
import type { FrameSink } from "../../lib/generation";
import { createArchitectureSlice } from "../../lib/store/architectureSlice";
import { createArch3dSlice } from "../../lib/store/arch3dSlice";
import { createFrameSink } from "../../lib/store/generationSink";
import { createGenerationSlice } from "../../lib/store/generationSlice";
import { createTraceSlice } from "../../lib/store/traceSlice";
import type { StoreState } from "../../lib/store/types";
import { createUISlice } from "../../lib/store/uiSlice";
import { storeDefinition } from "../../lib/store/index";
import { PRESET_PROMPTS, isByteFallbackToken } from "../../lib/prompts";
import { CHAPTERS } from "../../lib/walkthrough";
import type { AnalyzeResponse, GenDone, GenMeta, TokenFrame } from "../../lib/types";
import { buildHealthReportHtml } from "../../lib/healthReport";

function makeStore() {
  return createStore<StoreState>()((set, get, api) => ({
    ...createArchitectureSlice(set, get, api),
    ...createArch3dSlice(set, get, api),
    ...createGenerationSlice(set, get, api),
    ...createTraceSlice(set, get, api),
    ...createUISlice(set, get, api),
    loadGgufFile: async () => undefined,
    startGeneration: () => undefined,
    stopGeneration: () => undefined,
    loadTrace: async () => undefined,
    classroomStep: () => undefined,
  }));
}

test("architecture slice updates explorer controls", () => {
  const store = makeStore();
  store.getState().setPointBudget(42);
  store.getState().setTileView(true);
  store.getState().setSelectedTensor("layers.0.attn_q.weight");
  assert.equal(store.getState().pointBudget, 42);
  assert.equal(store.getState().tileView, true);
  assert.equal(store.getState().selectedTensor, "layers.0.attn_q.weight");
});

test("generation slice clamps playback settings", () => {
  const store = makeStore();
  store.getState().setPlaySpeed(99);
  store.getState().toggleFollow();
  assert.equal(store.getState().playSpeed, 4);
  assert.equal(store.getState().followMode, false);
});

test("trace slice keeps breakpoint updates immutable and bounds LOD", () => {
  const store = makeStore();
  const firstBreakpoints = store.getState().breakpoints;
  store.getState().toggleBreakpoint(4);
  store.getState().setLodLevel(9);
  assert.notEqual(store.getState().breakpoints, firstBreakpoints);
  assert.equal(store.getState().breakpoints.has(4), true);
  assert.equal(store.getState().lodLevel, 2);
});

test("trace slice marks a throwing watch expression with the clean error marker", () => {
  const store = makeStore();
  store.getState().addWatch("sum", "1 + 2");
  store.getState().addWatch("boom", "totallyUndefinedName");
  store.getState().evalWatches();
  assert.equal(store.getState().watches[0].value, 3);
  assert.equal(store.getState().watches[1].value, "‹error›");
});

test("UI slice clamps brightness and stops walkthrough autoplay on chapter selection", () => {
  const store = makeStore();
  store.getState().toggleWtPlay();
  store.getState().setWtChapter(3);
  store.getState().setBrightness(-2);
  assert.equal(store.getState().wtChapter, 3);
  assert.equal(store.getState().wtPlaying, false);
  assert.equal(store.getState().brightness, 0.3);
});

test("route isolation: navMode changes never mutate the active mode", () => {
  const store = makeStore();
  store.getState().setMode("debugger");
  store.getState().setNavMode("FOLLOW");
  assert.equal(store.getState().mode, "debugger");
  store.getState().setNavMode("OVERVIEW");
  assert.equal(store.getState().mode, "debugger");

  store.getState().setMode("generation");
  store.getState().setNavMode("MANUAL");
  assert.equal(store.getState().mode, "generation");
});

test("route isolation: setMode is the only store-level mode writer", () => {
  const store = makeStore();
  store.getState().setMode("walkthrough");
  assert.equal(store.getState().mode, "walkthrough");
  store.getState().setMode("explorer");
  assert.equal(store.getState().mode, "explorer");
});

// ─── Phase 5.2a (#311): frame-producer seam ────────────────────────────────

function sinkSpy() {
  const calls: string[] = [];
  const sink: FrameSink = {
    onMeta: () => calls.push("meta"),
    onToken: () => calls.push("token"),
    onDone: () => calls.push("done"),
    onError: (m) => calls.push(`error:${m}`),
    onClose: () => calls.push("close"),
  };
  return { sink, calls };
}

const metaFrame: GenMeta = {
  model: "gpt2",
  device: "webgpu",
  architecture: "gpt2",
  num_layer_stats: 12,
  num_layers: 12,
  prompt_tokens: ["a"],
  prompt_len: 1,
  max_new_tokens: 8,
  top_k: 10,
  decoding: "greedy",
};

const tokenFrame: TokenFrame = {
  type: "token",
  step: 0,
  chosen: { id: 1, text: "b", logprob: -0.5 },
  topk: [],
  layer_stats: [],
  eos: false,
  phase: "decode",
  n_positions: 3,
  cache_len: 3,
};

const doneFrame: GenDone = {
  type: "done",
  generated_text: "b",
  total_steps: 1,
};

test("Phase 5.2a: dispatchRawFrame routes all four wire frame types to the sink", () => {
  const { sink, calls } = sinkSpy();
  dispatchRawFrame({ type: "meta", ...metaFrame }, sink);
  dispatchRawFrame(tokenFrame, sink);
  dispatchRawFrame(doneFrame, sink);
  dispatchRawFrame({ type: "error", message: "boom" }, sink);
  dispatchRawFrame({ type: "unknown-type" }, sink);
  assert.deepEqual(calls, ["meta", "token", "done", "error:boom"]);
});

test("Phase 5.2a: localSource reports honestly until an engine is registered", () => {
  registerLocalEngine(null);
  const { sink, calls } = sinkSpy();
  const handle = localSource("hi", {}, sink);
  assert.equal(calls.includes("meta"), false);
  assert.equal(calls.some((c) => c.startsWith("error:")), true);
  handle.close();
});

test("Phase 5.2a: registered local engine streams frames through the seam", () => {
  let closed = false;
  registerLocalEngine(() => {
    return {
      close: () => {
        closed = true;
      },
    };
  });
  const { sink, calls } = sinkSpy();
  const handle = localSource("hi", {}, sink);
  sink.onMeta(metaFrame);
  sink.onToken(tokenFrame);
  sink.onDone(doneFrame);
  handle.close();
  assert.deepEqual(calls, ["meta", "token", "done"]);
  assert.equal(closed, true);
  registerLocalEngine(null);
});

test("Phase 5.2a: createFrameSink transitions the store from raw frames", () => {
  const store = makeStore();
  const api = { set: store.setState, get: store.getState };
  // Drive the store's `set` through the same FrameSink build startGeneration uses.
  const sink = createFrameSink(api.set);
  sink.onMeta(metaFrame);
  assert.equal(store.getState().genMeta?.model, "gpt2");
  sink.onToken(tokenFrame);
  assert.equal(store.getState().genFrames.length, 1);
  assert.equal(store.getState().playIndex, 0);
  sink.onDone(doneFrame);
  assert.equal(store.getState().genStatus, "done");
  assert.equal(store.getState().genText, "b");
});

test("Phase 5.2a: error frame while streaming flips status to error", () => {
  const store = makeStore();
  const api = { set: store.setState, get: store.getState };
  const sink = createFrameSink(api.set);
  store.getState().setAutoStarted(true);
  sink.onError("connection error");
  assert.equal(store.getState().genStatus, "error");
  assert.equal(store.getState().genError, "connection error");
});


test("startGeneration resets analysis data and invokes the generation source", () => {
  const captured: { prompt?: string; source?: string; sink?: FrameSink } = {};

  registerLocalEngine((prompt, opts, sink) => {
    captured.prompt = prompt;
    captured.source = opts.source;
    captured.sink = sink;
    return { close: () => undefined };
  });

  try {
    const store = createStore<StoreState>()(storeDefinition);
    store.setState({
      data: { sentence: "stale analysis" } as any,
      genFrames: [tokenFrame as any],
      genText: "stale text",
      genError: "previous error",
      genStatus: "done" as any,
      playIndex: 5,
      isPlaying: true,
      opIndex: 3,
      opPlaying: true,
      autoStarted: true,
      traceSource: "file" as any,
      debugSnapshots: { 0: {} as any },
      debugSnapshotError: "snap error",
    });

    assert.ok(store.getState().data !== null);
    store.getState().startGeneration("test prompt", { source: "local" });

    assert.equal(store.getState().data, null);
    assert.deepEqual(store.getState().genFrames, []);
    assert.equal(store.getState().genText, "");
    assert.equal(store.getState().genError, null);
    assert.equal(store.getState().genStatus, "streaming");
    assert.equal(store.getState().traceSource, "live");
    assert.equal(store.getState().playIndex, -1);
    assert.equal(store.getState().isPlaying, false);
    assert.equal(store.getState().opIndex, 0);
    assert.equal(store.getState().opPlaying, false);
    assert.equal(store.getState().autoStarted, false);
    assert.deepEqual(store.getState().debugSnapshots, {});
    assert.equal(store.getState().debugSnapshotError, null);

    assert.equal(captured.prompt, "test prompt");
    assert.equal(captured.source, "local");
    assert.ok(captured.sink !== undefined);
    assert.equal(typeof captured.sink!.onMeta, "function");
    assert.equal(typeof captured.sink!.onToken, "function");
    assert.equal(typeof captured.sink!.onError, "function");
  } finally {
    registerLocalEngine(null);
  }
});

test("Phase 4.1: isByteFallbackToken identifies byte-fallback pieces and high IDs", () => {
  assert.equal(isByteFallbackToken({ piece: "<0xE0>", id: 100, text: "" }), true);
  assert.equal(isByteFallbackToken({ piece: "<0xA4>", id: 101, text: "" }), true);
  assert.equal(isByteFallbackToken({ piece: "<byte_0x89>", id: 102, text: "" }), true);
  assert.equal(isByteFallbackToken({ piece: "byte:224", id: 103, text: "" }), true);
  assert.equal(isByteFallbackToken({ piece: "word", id: 151000, text: "word" }), true);
  assert.equal(isByteFallbackToken({ piece: "word", id: 100, text: "�" }), true);
  assert.equal(isByteFallbackToken({ piece: "The", id: 785, text: "The" }), false);
  assert.equal(isByteFallbackToken({ piece: "Ġcat", id: 3797, text: " cat" }), false);
});

test("Phase 4.1: PRESET_PROMPTS contains non-Latin scripts (Hindi, Tamil, CJK)", () => {
  const labels = PRESET_PROMPTS.map((p) => p.label);
  assert.ok(labels.includes("Tamil"), "contains Tamil prompt");
  assert.ok(labels.includes("Hindi"), "contains Hindi prompt");
  assert.ok(labels.includes("Chinese"), "contains Chinese prompt");
  assert.ok(labels.includes("English"), "contains English prompt");

  for (const p of PRESET_PROMPTS) {
    assert.ok(p.text.length > 0, `${p.label} text should not be empty`);
    assert.ok(p.note.length > 0, `${p.label} note should not be empty`);
  }
});

test("Phase 4.1: Walkthrough tokenizer chapter reports byte-fallback dimensions when present", () => {
  const tokChapter = CHAPTERS.find((c) => c.id === "tokenizer");
  assert.ok(tokChapter, "tokenizer chapter exists");

  const mockNonLatinData: AnalyzeResponse = {
    sentence: "नमस्ते",
    tokens: [
      { index: 0, id: 151200, piece: "<0xE0>", text: "", is_special: false },
      { index: 1, id: 151201, piece: "<0xA4>", text: "", is_special: false },
      { index: 2, id: 151202, piece: "<0xA8>", text: "", is_special: false },
    ],
    hidden_states_3d: {},
    embeddings_3d: [],
    embedding_norms: [],
    attention: [],
    projection: null,
    logit_lens: [],
    device: "cpu",
    model: "Qwen2.5-0.5B",
    num_layers: 24,
    num_heads: 14,
    hidden_size: 896,
  };

  const meta = {
    hidden_size: 896,
    num_heads: 14,
    num_kv_heads: 2,
    head_dim: 64,
    ffn_size: 4864,
    vocab_size: 151936,
    num_layers: 24,
  };

  const inspector = tokChapter!.inspector(mockNonLatinData, meta);
  assert.equal(inspector.dimensions["Tokens"], "3");
  assert.equal(inspector.dimensions["Byte-fallback"], "3 tokens");
});

test("Phase 5.8a: Sonification toggle and math mappings", () => {
  const store = makeStore();
  const { computeLayerPitch, computeChordFrequencies, setSonificationEnabled, isSonificationEnabled } = require("../../lib/sonification");

  // 1. Independent toggle states: Sonify never mutates muted, muted never mutates Sonify
  assert.equal(store.getState().sonificationEnabled, false);
  assert.equal(store.getState().muted, true);

  // Toggle Sonify ON: muted remains true
  store.getState().toggleSonification();
  assert.equal(store.getState().sonificationEnabled, true);
  assert.equal(store.getState().muted, true);

  // Toggle Sound ON (unmute): sonification remains true
  store.getState().toggleMuted();
  assert.equal(store.getState().sonificationEnabled, true);
  assert.equal(store.getState().muted, false);

  // Toggle Sonify OFF: Sound remains unmuted
  store.getState().toggleSonification();
  assert.equal(store.getState().sonificationEnabled, false);
  assert.equal(store.getState().muted, false);

  // 2. Direct sonification module state
  setSonificationEnabled(false);
  assert.equal(isSonificationEnabled(), false);
  setSonificationEnabled(true);
  assert.equal(isSonificationEnabled(), true);

  // 3. Layer pitch mapping: 150 Hz at layer 0 to 500 Hz at layer N-1
  assert.equal(computeLayerPitch(0, 24), 150);
  assert.equal(computeLayerPitch(23, 24), 500);
  assert.equal(computeLayerPitch(0, 1), 150);

  // 4. Chord frequencies derived from entropy and norm
  // Min entropy (0) and min norm (0)
  const low = computeChordFrequencies(0, 0, 0.5);
  assert.equal(low.baseFreq, 200);
  assert.equal(low.harmonic, 300); // 200 * 1.5
  assert.equal(low.brightFreq, 450); // 200 * (2 + 0.25)

  // Max entropy (1) and max norm (>= 50)
  const high = computeChordFrequencies(1, 50, 0.5);
  assert.equal(high.baseFreq, 800);
  assert.equal(high.harmonic, 2000); // 800 * 2.5
  assert.equal(high.brightFreq, 1800); // 800 * 2.25

  // 5. Edge cases: totalLayers <= 1, invalid / undefined / negative values
  assert.equal(computeLayerPitch(0, 1), 150);
  assert.equal(computeLayerPitch(0, 0), 150);
  assert.equal(computeLayerPitch(0, -5), 150);
  assert.equal(computeLayerPitch(NaN, 12), 150);
  assert.equal(computeLayerPitch(5, NaN), 150);
  assert.equal(computeLayerPitch(999, 12), 500); // clamps to max layer (N-1)
  assert.equal(computeLayerPitch(-10, 12), 150); // clamps to min layer (0)

  // 6. Edge cases: entropy out of bounds (<0, >1), NaN, undefined, negative norm
  const clampedLow = computeChordFrequencies(-2, -10, -1);
  assert.equal(clampedLow.baseFreq, 200);
  assert.equal(clampedLow.harmonic, 300);
  assert.equal(clampedLow.brightFreq, 400); // safeSpread clamped to 0 -> 200 * 2.0 = 400

  const clampedHigh = computeChordFrequencies(5, 500, 10);
  assert.equal(clampedHigh.baseFreq, 800);
  assert.equal(clampedHigh.harmonic, 2000); // norm clamped to 50 -> 800 * 2.5 = 2000
  assert.equal(clampedHigh.brightFreq, 2000); // safeSpread clamped to 1 -> 800 * 2.5 = 2000

  const nanFallback = computeChordFrequencies(NaN, NaN, NaN);
  assert.equal(nanFallback.baseFreq, 200);
  assert.equal(nanFallback.harmonic, 300);
  assert.equal(nanFallback.brightFreq, 450); // fallback spread 0.5 -> 200 * 2.25 = 450
});

test("Phase 5.8a: computeLayerPitch uses real attention-focus when provided", () => {
  const { computeLayerPitch } = require("../../lib/sonification");

  // Valid focus at layer 0 (progress=0, layerTint=0):
  //   attentionFreq = 200 + focus*500; finalFreq = clamp(attentionFreq, 100, 900)
  assert.equal(computeLayerPitch(0, 24, 0),   200); // min focus -> 200 Hz
  assert.equal(computeLayerPitch(0, 24, 1.0), 700); // max focus -> 700 Hz
  assert.equal(computeLayerPitch(0, 24, 0.5), 450); // mid focus -> 450 Hz

  // Valid focus at last layer (progress=1, layerTint=50 Hz):
  //   finalFreq = clamp(attentionFreq + 50, 100, 900)
  assert.equal(computeLayerPitch(23, 24, 0),   250); // 200 + 50 tint
  assert.equal(computeLayerPitch(23, 24, 1.0), 750); // 700 + 50 tint
  assert.equal(computeLayerPitch(23, 24, 0.5), 500); // 450 + 50 tint

  // Out-of-range focus values are clamped to [0, 1]:
  assert.equal(computeLayerPitch(0, 24, -1),  200); // clamped to 0 -> 200 Hz
  assert.equal(computeLayerPitch(0, 24, 2.0), 700); // clamped to 1 -> 700 Hz

  // Missing or NaN focus -> fallback to layer-progression (150-500 Hz):
  assert.equal(computeLayerPitch(0,  24, undefined), 150); // layer 0 fallback
  assert.equal(computeLayerPitch(23, 24, undefined), 500); // layer 23 fallback
  assert.equal(computeLayerPitch(0,  24, NaN),       150); // NaN treated as absent
  assert.equal(computeLayerPitch(23, 24, NaN),       500); // NaN treated as absent

  // Clamping to [100, 900] is applied to the attention-driven result:
  // Extreme values stay within bounds (already satisfied by the formula above,
  // but verify the guard is present):
  const minPitch = computeLayerPitch(0, 24, 0);
  const maxPitch = computeLayerPitch(23, 24, 1.0);
  assert.ok(minPitch >= 100 && minPitch <= 900, `minPitch ${minPitch} out of [100,900]`);
  assert.ok(maxPitch >= 100 && maxPitch <= 900, `maxPitch ${maxPitch} out of [100,900]`);
});

test("HF Explorer: hfExplorerOpen defaults to false, open/close round-trips correctly", () => {
  const store = makeStore();
  assert.equal(store.getState().hfExplorerOpen, false);
  store.getState().setHfExplorerOpen(true);
  assert.equal(store.getState().hfExplorerOpen, true);
  store.getState().setHfExplorerOpen(false);
  assert.equal(store.getState().hfExplorerOpen, false);
});

test("Phase 5.8a: anchor positions map to correct attention entries and pitch calculation receives normalized transformer layer index", () => {
  const { anchorToLayerIndex, layerAnchors } = require("../../lib/playback");
  const { computeLayerPitch } = require("../../lib/sonification");

  const catalog = [
    { op_key: "embedding", name: "embed", shape: [100, 10], layer: null },
    { op_key: "attention", name: "l0_attn", shape: [10, 10], layer: 0 },
    { op_key: "mlp", name: "l0_mlp", shape: [10, 10], layer: 0 },
    { op_key: "attention", name: "l1_attn", shape: [10, 10], layer: 1 },
    { op_key: "output", name: "lm_head", shape: [10, 100], layer: null },
  ];
  const numLayers = 2;
  const anchors = layerAnchors(catalog, numLayers); // [0, 1, 3, 4]

  // 1. Embedding anchor position (pos = 0) must map to -1 (not transformer layer 0)
  const embedLayerIdx = anchorToLayerIndex(catalog, anchors, 0, numLayers);
  assert.equal(embedLayerIdx, -1);

  // 2. Transformer layer 0 anchor position (pos = 1) must map to 0
  const l0LayerIdx = anchorToLayerIndex(catalog, anchors, 1, numLayers);
  assert.equal(l0LayerIdx, 0);

  // 3. Transformer layer 1 anchor position (pos = 2) must map to 1
  const l1LayerIdx = anchorToLayerIndex(catalog, anchors, 2, numLayers);
  assert.equal(l1LayerIdx, 1);

  // 4. Output anchor position (pos = 3) maps to numLayers (2)
  const outLayerIdx = anchorToLayerIndex(catalog, anchors, 3, numLayers);
  assert.equal(outLayerIdx, 2);

  // 5. Attention lookup: embedding position must NOT use layer 0's attention focus
  const mockAttentionFocus = [0.85, 0.40]; // layer 0 focus = 0.85, layer 1 focus = 0.40
  const getFocus = (rawIdx: number) =>
    rawIdx >= 0 && rawIdx < numLayers ? mockAttentionFocus[rawIdx] : undefined;

  assert.equal(getFocus(embedLayerIdx), undefined); // embedding -> undefined focus (fallback pitch)
  assert.equal(getFocus(l0LayerIdx), 0.85);          // layer 0 -> real layer 0 attention focus (0.85)
  assert.equal(getFocus(l1LayerIdx), 0.40);          // layer 1 -> real layer 1 attention focus (0.40)
  assert.equal(getFocus(outLayerIdx), undefined);    // output -> undefined focus (fallback pitch)

  // 6. Pitch calculation receives normalized transformer layer index (not s.opIndex):
  // Layer 0 receives layerIndex = 0, focus = 0.85 -> 200 + 0.85*500 + 0 = 625 Hz
  const l0Pitch = computeLayerPitch(0, numLayers, getFocus(l0LayerIdx));
  assert.equal(l0Pitch, 625);

  // Layer 1 receives layerIndex = 1, focus = 0.40 -> 200 + 0.40*500 + 50 = 450 Hz
  const l1Pitch = computeLayerPitch(1, numLayers, getFocus(l1LayerIdx));
  assert.equal(l1Pitch, 450);

  // Embedding receives layerIndex = 0, focus = undefined -> fallback 150 Hz
  const embedPitch = computeLayerPitch(0, numLayers, getFocus(embedLayerIdx));
  assert.equal(embedPitch, 150);

  // 7. Safety guards: out-of-range anchor positions safely return -1
  assert.equal(anchorToLayerIndex(catalog, anchors, -1, numLayers), -1);
  assert.equal(anchorToLayerIndex(catalog, anchors, 999, numLayers), -1);
  assert.equal(anchorToLayerIndex([], [], 0, numLayers), -1);
});

test("Phase 5.8d: buildHealthReportHtml generates complete report with capabilities matrix, provenance, and timings", () => {
  const mockSession = {
    arch: {
      metadata: {
        name: "Qwen/Qwen2.5-0.5B",
        architecture: "Qwen2ForCausalLM",
        total_params: 490000000,
        num_layers: 24,
        num_heads: 14,
        num_kv_heads: 2,
        context_length: 32768,
        hidden_size: 896,
        torch_dtype: "bfloat16",
      },
      tensor_count: 290,
      tensors: [],
    },
    capabilities: {
      compatibility_level: "High",
      compatibility_reason: "Full architectural telemetry available.",
      supports_attention: { supported: true, confidence: "high", reason: "Softmax attention extracted." },
      supports_hidden_states: { supported: true, confidence: "high", reason: "Residual streams extracted." },
      supports_logit_lens: { supported: true, confidence: "high", reason: "LM head projection available." },
      supports_activation_patch: { supported: true, confidence: "medium", reason: "Hooks available." },
      supports_head_ablation: { supported: false, confidence: "high", reason: "Ablation not configured." },
      supports_layer_ablation: { supported: true, confidence: "high", reason: "Layer bypass supported." },
      vram_estimate: { estimated_vram_gb: 1.2, estimation_basis: "Weights + KV", confidence: "high" },
    },
    provenance: {
      source_type: "REAL",
      backend: "PyTorch (CUDA 12.4)",
      device: "cuda:0",
    },
    timings: {
      kind: "real" as const,
      perLayer: [0.45, 0.52, 0.48, 0.61],
      total: 2.06,
      max: 0.61,
    },
    genFrames: [
      { type: "token" as const, step: 0, chosen: { id: 1, text: "Hi", logprob: -0.1 }, topk: [], layer_stats: [], eos: false },
      { type: "token" as const, step: 1, chosen: { id: 2, text: " there", logprob: -0.2 }, topk: [], layer_stats: [], eos: true },
    ],
  };

  const html = buildHealthReportHtml(mockSession);

  // 1. Basic document integrity
  assert.ok(html.includes("<!DOCTYPE html>"), "Contains DOCTYPE");
  assert.ok(html.includes("TokenPrint Health Report - Qwen/Qwen2.5-0.5B"), "Contains title with model name");
  assert.ok(html.includes("490.00M"), "Formats total parameter count");

  // 2. Phase 5.8d Capabilities Matrix
  assert.ok(html.includes("Model Capabilities &amp; Inspection Support"), "Includes capabilities section");
  assert.ok(html.includes("Compatibility: <strong>High</strong>"), "Includes compatibility level");
  assert.ok(html.includes("Self-Attention Weights"), "Lists self-attention capability");
  assert.ok(html.includes("Hidden States &amp; Residuals"), "Lists hidden states capability");
  assert.ok(html.includes("Logit Lens Projection"), "Lists logit lens capability");
  assert.ok(html.includes("1.2 GB VRAM"), "Includes VRAM estimate");

  // 3. Phase 5.8d Provenance Section
  assert.ok(html.includes("Session Provenance &amp; Runtime Authority"), "Includes provenance section");
  assert.ok(html.includes("REAL DATA"), "Includes REAL data badge");
  assert.ok(html.includes("PyTorch (CUDA 12.4)"), "Includes execution backend");
  assert.ok(html.includes("cuda:0"), "Includes target device");

  // 4. Phase 5.8d Timings Section
  assert.ok(html.includes("Per-Layer Latency &amp; Execution Timings"), "Includes timings section");
  assert.ok(html.includes("REAL MS · HARDWARE TIME"), "Includes REAL MS timing badge");
  assert.ok(html.includes("2.06 ms"), "Includes total step latency");
  assert.ok(html.includes("timing-track"), "Renders timing graph tracks");

  // 5. Printable PDF Features
  assert.ok(html.includes("@media print"), "Contains @media print stylesheet");
  assert.ok(html.includes("@page {"), "Contains @page print dimensions");
  assert.ok(html.includes("print-toolbar"), "Contains interactive toolbar with print button");
  assert.ok(html.includes("window.print()"), "Contains window.print() action trigger");
});

test("Phase 5.8d: buildHealthReportHtml handles proxy activation timings gracefully", () => {
  const mockSession = {
    arch: {
      metadata: { name: "GPT-2 Base" },
      tensor_count: 144,
      tensors: [],
    },
    timings: {
      kind: "proxy" as const,
      perLayer: [12.4, 14.2, 10.1],
      total: null,
      max: 14.2,
    },
  };

  const html = buildHealthReportHtml(mockSession);

  // Must reflect that timings are proxy norms, NOT wall-clock ms
  assert.ok(html.includes("PROXY · ACTIVATION NORM"), "Labels timing as proxy norm");
  assert.ok(html.includes("Real hardware execution timings were omitted"), "Explains proxy timing fallback");
  assert.ok(html.includes("norm"), "Labels timing values with norm suffix instead of ms");
});

test("Phase 5.8d: buildHealthReportHtml handles null/empty session safely", () => {
  const html = buildHealthReportHtml({});

  assert.ok(html.includes("<!DOCTYPE html>"), "Renders valid document even for empty input");
  assert.ok(html.includes("Model Architecture"), "Falls back to default model name");
  assert.ok(html.includes("Health Score"), "Renders health score badge");
});

test("Phase 5.8d review fixes: HTML escaping, malformed timings, provenance, font privacy", () => {
  // 1. Issue 1: Escapes untrusted dimension values against XSS
  const xssSession: any = {
    genMeta: {
      model: "SafeModel",
      architecture: "Transformer",
      num_layers: "<script>alert('xss-layers')</script>",
      model_dimensions: {
        num_heads: "<img src=x onerror=alert('xss-heads')>",
        num_kv_heads: "<b onclick='bad()'>kv</b>",
        context_length: "<div>bad-ctx</div>",
        hidden_size: "<iframe src=javascript:alert(1)>",
      },
    },
  };
  const xssHtml = buildHealthReportHtml(xssSession);
  assert.equal(xssHtml.includes("<script>alert('xss-layers')</script>"), false, "Escapes script tag in layers");
  assert.equal(xssHtml.includes("<img src=x onerror=alert('xss-heads')>"), false, "Escapes img tag in heads");
  assert.equal(xssHtml.includes("<iframe src=javascript:alert(1)>"), false, "Escapes iframe in hidden size");
  assert.ok(xssHtml.includes("&lt;script&gt;"), "Contains escaped HTML entity");

  // 2. Issue 2: Malformed timings do not throw val.toFixed()
  const malformedTimingsSession: any = {
    timings: {
      kind: "real" as const,
      perLayer: ["bad", NaN, null, undefined, 4.2],
      total: null,
      max: 4.2,
    },
  };
  assert.doesNotThrow(() => {
    const timingHtml = buildHealthReportHtml(malformedTimingsSession);
    assert.ok(timingHtml.includes("4.20 ms"), "Formats valid numeric entry");
  });

  // 3. Issue 3: Unmeasured checks appear unknown and health score calculates only from measured
  const unmeasuredHtml = buildHealthReportHtml({});
  assert.ok(unmeasuredHtml.includes("— UNKNOWN"), "Unmeasured sentinel checks render UNKNOWN");
  assert.ok(unmeasuredHtml.includes("Unmeasured · No Telemetry Checks"), "Health score reflects unmeasured state");

  // 4. Issue 4: Missing capabilities appear unknown, not supported
  const emptyCapsHtml = buildHealthReportHtml({});
  assert.ok(emptyCapsHtml.includes("Compatibility: <strong>Unknown</strong>"), "Compatibility defaults to Unknown");
  assert.ok(emptyCapsHtml.includes("Capability status not reported or verified for this session."), "Explains unmeasured capability");
  assert.equal(emptyCapsHtml.includes("Fully supported and verified by runtime."), false, "Does not falsely claim verified support");

  // 5. Issue 5: Parameter count is not understated via vocab*hidden
  const dimsOnlySession: any = {
    genMeta: {
      model_dimensions: { vocab_size: 32000, hidden_size: 4096 },
    },
  };
  const dimsHtml = buildHealthReportHtml(dimsOnlySession);
  assert.ok(dimsHtml.includes(">N/A<"), "Displays N/A when total_params is unavailable instead of embedding product");
  assert.equal(dimsHtml.includes("131.07M"), false, "Does not understate model params as vocab * hidden");

  // 6. Issue 6: Per-layer sum is labeled as sum of per-layer timings, not total step latency
  const realTimingsSession = {
    timings: {
      kind: "real" as const,
      perLayer: [1.5, 2.5],
      total: 4.0,
      max: 2.5,
    },
  };
  const realTimingHtml = buildHealthReportHtml(realTimingsSession);
  assert.ok(realTimingHtml.includes("Sum of per-layer timings:"), "Accurately labels sum of per-layer timings");
  assert.equal(realTimingHtml.includes("Total step latency:"), false, "Does not mislabel hook duration as total step latency");

  // 7. Issue 7: Print styles override timing list container height and overflow
  assert.ok(realTimingHtml.includes(".timing-list-container"), "Uses timing list container class");
  assert.ok(
    realTimingHtml.includes(".timing-list-container {\n        max-height: none !important;\n        overflow: visible !important;\n        height: auto !important;\n      }"),
    "Overrides timing container max-height and overflow in print styles"
  );

  // 8. Issue 8: Provenance without evidence is labeled unknown / unverified
  const noEvidenceHtml = buildHealthReportHtml({});
  assert.ok(noEvidenceHtml.includes("UNKNOWN DATA"), "Badges unknown origin when no evidence provided");
  assert.equal(noEvidenceHtml.includes("● VERIFIED"), false, "Does not assert verified backend without evidence");
  assert.equal(noEvidenceHtml.includes("● ACTIVE"), false, "Does not assert active device without evidence");

  // 9. Issue 9: Report does not contact Google Fonts.
  // Extract exact hosts instead of substring-matching, so a lookalike domain
  // (e.g. fonts.googleapis.com.evil.example) cannot satisfy the assertion.
  const externalHosts = new Set(
    Array.from(
      realTimingHtml.matchAll(/(?:https?:)?\/\/([^/\s"'<>]+)/gi),
      (m) => (m[1] ?? "").toLowerCase()
    )
  );
  assert.equal(externalHosts.has("fonts.googleapis.com"), false, "Does not contact fonts.googleapis.com");
  assert.equal(externalHosts.has("fonts.gstatic.com"), false, "Does not contact fonts.gstatic.com");
});

test("Phase 5.8c: Collab store slice toggling, initial state, and peer management", () => {
  const store = makeStore();

  // Initial state check
  const state0 = store.getState();
  assert.equal(state0.collabEnabled, false);
  assert.equal(state0.collabConnected, false);
  assert.deepEqual(state0.collabPeers, {});

  // Toggle collab
  state0.toggleCollab();
  assert.equal(store.getState().collabEnabled, true);

  // Set room ID
  state0.setCollabRoomId("tensor-collab-42");
  assert.equal(store.getState().collabRoomId, "tensor-collab-42");

  // Populate peers
  const peerAlice = {
    user_id: "alice",
    name: "Alice",
    color: "#10b981",
    role: "viewer" as const,
  };
  const peerBob = {
    user_id: "bob",
    name: "Bob",
    color: "#3b82f6",
    role: "presenter" as const,
  };
  state0.setCollabPeers({ alice: peerAlice, bob: peerBob });
  assert.equal(Object.keys(store.getState().collabPeers).length, 2);

  // Update peer cursor
  const cursorAlice = { x: 0.35, y: 0.65, activeLayer: 3, activeOp: "attn", timestamp: 1000 };
  state0.updatePeerCursor("alice", cursorAlice);
  const updatedAlice = store.getState().collabPeers["alice"];
  assert.deepEqual(updatedAlice.cursor, cursorAlice);

  // Update peer selection
  const selBob = { kind: "layer" as const, index: 8, name: "Layer 8" };
  state0.updatePeerSelection("bob", selBob);
  const updatedBob = store.getState().collabPeers["bob"];
  assert.deepEqual(updatedBob.selection, selBob);

  // Classroom presenter mode toggle
  assert.equal(store.getState().classroomPresenting, false);
  state0.toggleClassroomPresenting();
  assert.equal(store.getState().classroomPresenting, true);

  // Classroom mode activates collab channel as per Issue #301 (Phase 5.8c / 5.6 overlap)
  store.setState({ classroomMode: false, collabEnabled: false });
  store.getState().toggleClassroomMode();
  assert.equal(store.getState().classroomMode, true);
  assert.equal(store.getState().collabEnabled, true);

  // Early peer update buffering: updates for unknown peers create placeholder and merge into presence
  const earlyCursor = { x: 0.1, y: 0.2, timestamp: 2000 };
  store.getState().updatePeerCursor("early-peer", earlyCursor);
  assert.ok(store.getState().collabPeers["early-peer"]);
  assert.deepEqual(store.getState().collabPeers["early-peer"].cursor, earlyCursor);

  // When presence arrives without a cursor, the buffered cursor is preserved
  store.getState().setCollabPeers({
    "early-peer": {
      user_id: "early-peer",
      name: "Early Peer",
      color: "#10b981",
      role: "viewer",
    },
  });
  assert.equal(store.getState().collabPeers["early-peer"].name, "Early Peer");
  assert.deepEqual(store.getState().collabPeers["early-peer"].cursor, earlyCursor);
});

test("Phase 5.8c: normalizeCursor correctly clamps coordinates and attaches layer metadata", () => {
  const { normalizeCursor, sanitizeColor } = require("../../lib/collab/client");

  // Centered coordinate
  const c1 = normalizeCursor(500, 250, 1000, 500, { activeLayer: 5, activeOp: "mlp" });
  assert.equal(c1.x, 0.5);
  assert.equal(c1.y, 0.5);
  assert.equal(c1.activeLayer, 5);
  assert.equal(c1.activeOp, "mlp");
  assert.ok(typeof c1.timestamp === "number");

  // Extreme out-of-bounds coordinates must clamp safely to [0, 1]
  const c2 = normalizeCursor(-200, 1200, 800, 600);
  assert.equal(c2.x, 0);
  assert.equal(c2.y, 1);
  assert.equal(c2.activeLayer, null);
  assert.equal(c2.activeOp, null);

  // Zero dimensions guard (no division by zero)
  const c3 = normalizeCursor(10, 10, 0, 0);
  assert.ok(Number.isFinite(c3.x));
  assert.ok(Number.isFinite(c3.y));

  // Color sanitization against CSS injection
  assert.equal(sanitizeColor("#10b981"), "#10b981");
  assert.equal(sanitizeColor("#FFFFFF"), "#FFFFFF");
  assert.equal(sanitizeColor("url(http://evil.com)"), "#38bdf8");
  assert.equal(sanitizeColor("red; background: blue"), "#38bdf8");
  assert.equal(sanitizeColor(undefined), "#38bdf8");
});


// --- loadArchitecture(modelId) regression tests (refs #275) ---------------- //
const sampleArch = {
  source: "model",
  model: "demo",
  metadata: {},
  tensor_count: 0,
  tensors: [],
} as any;

async function withFakeFetch(
  handler: (url: string) => unknown,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => handler(String(input))) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("loadArchitecture(modelId) requests the selected model", async () => {
  const urls: string[] = [];
  await withFakeFetch(
    (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => sampleArch };
    },
    async () => {
      const store = makeStore();
      await store.getState().loadArchitecture("TinyLlama/TinyLlama-1.1B-Chat-v1.0");
      assert.equal(urls.length, 1);
      assert.ok(
        urls[0].endsWith("/architecture?model_id=TinyLlama%2FTinyLlama-1.1B-Chat-v1.0"),
        `unexpected url: ${urls[0]}`,
      );
      assert.equal(store.getState().arch?.model, "demo");
      assert.equal(store.getState().archLoading, false);
      assert.equal(store.getState().archError, null);
    },
  );
});

test("loadArchitecture() without a modelId requests the default model", async () => {
  const urls: string[] = [];
  await withFakeFetch(
    (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => sampleArch };
    },
    async () => {
      const store = makeStore();
      await store.getState().loadArchitecture();
      assert.equal(urls.length, 1);
      assert.ok(urls[0].endsWith("/architecture"), `unexpected url: ${urls[0]}`);
      assert.equal(urls[0].includes("model_id"), false);
    },
  );
});

test("loadArchitecture surfaces a failed request as archError", async () => {
  await withFakeFetch(
    () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => {
      const store = makeStore();
      await store.getState().loadArchitecture("some/model");
      assert.equal(store.getState().arch, null);
      assert.equal(store.getState().archLoading, false);
      assert.equal(store.getState().archError, "Architecture request failed (500)");
    },
  );
});

test("loadArchitecture ignores a stale response after the trace source changes", async () => {
  let resolveFetch: (value: unknown) => void = () => undefined;
  await withFakeFetch(
    () => new Promise((resolve) => { resolveFetch = resolve; }),
    async () => {
      const store = makeStore();
      store.setState({ traceSource: "live" as any });
      const pending = store.getState().loadArchitecture("some/model");
      // A trace file is loaded while the request is still in flight.
      store.setState({ traceSource: "file" as any });
      resolveFetch({ ok: true, status: 200, json: async () => sampleArch });
      await pending;
      assert.equal(store.getState().arch, null);
      assert.equal(store.getState().archLoading, false);
    },
  );
});