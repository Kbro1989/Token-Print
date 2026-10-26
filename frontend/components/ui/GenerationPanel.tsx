"use client";

import type { CSSProperties } from "react";
import { useStore } from "@/lib/store";
import { activeLayerOf, phaseInfo } from "@/lib/playback";
import {
  attendedPositions,
  findNeedleSpan,
  needleResidency,
  windowState,
} from "@/lib/genReadouts";
import type { TopKCandidate } from "@/lib/types";
import { Button, TOKENS } from "./primitives";

const sectStyle = {
  marginTop: "4px",
} as const;

const sectHead: CSSProperties = {
  fontFamily: TOKENS.fontMono,
  fontSize: "9px",
  letterSpacing: "0.1em",
  color: TOKENS.textMuted,
  borderBottom: `1px solid ${TOKENS.border}`,
  paddingBottom: "3px",
  marginBottom: "4px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "3px 0",
  fontFamily: TOKENS.fontMono,
  fontSize: "10px",
};

const keyStyle: CSSProperties = { color: TOKENS.textMuted, fontSize: "9px", letterSpacing: "0.08em" };
const valStyle: CSSProperties = {
  color: TOKENS.textPrimary,
  textAlign: "right",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "150px",
};

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <div style={sectHead}>
      <span>{title}</span>
      {right && <span style={{ color: TOKENS.textSecondary, fontFamily: TOKENS.fontMono }}>{right}</span>}
    </div>
  );
}

function Predictions({ topk }: { topk: TopKCandidate[] }) {
  const maxProb = Math.max(1e-6, ...topk.map((c) => c.prob));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {topk.slice(0, 8).map((c, i) => {
        const pc = c.prob * 100;
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ ...keyStyle, width: "16px", color: i === 0 ? "#7fd7c8" : TOKENS.textMuted }}>
              {i + 1}
            </span>
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                fontSize: "10px",
                color: i === 0 ? TOKENS.textPrimary : TOKENS.textSecondary,
                width: "96px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.text.replace(/\n/g, "⏎") || "␣"}
            </span>
            <div style={{ flex: 1, height: 4, background: TOKENS.surfaceRaised, borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(2, (c.prob / maxProb) * 100)}%`,
                  background: i === 0 ? "#7fd7c8" : TOKENS.borderStrong,
                }}
              />
            </div>
            <span style={{ fontFamily: TOKENS.fontMono, fontSize: "9.5px", color: TOKENS.textPrimary, minWidth: "52px", textAlign: "right" }}>
              {pc.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Logits({ topk }: { topk: TopKCandidate[] }) {
  if (!topk.length) return null;
  const max = Math.max(1e-6, ...topk.map((c) => c.logit));
  const min = Math.min(...topk.map((c) => c.logit));
  const span = Math.max(1e-6, max - min);
  const cols = 24;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {topk.slice(0, 8).map((c, i) => {
        const v = (c.logit - min) / span;
        const cells = Math.max(1, Math.round(v * cols));
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ ...keyStyle, width: "16px", color: i === 0 ? "#7fd7c8" : TOKENS.textMuted }}>{i + 1}</span>
            <div style={{ flex: 1, display: "flex", gap: 1 }}>
              {Array.from({ length: cols }, (_, k) => (
                <div
                  key={k}
                  style={{
                    flex: 1,
                    height: 5,
                    background: k < cells ? (i === 0 ? "#7fd7c8" : TOKENS.borderStrong) : TOKENS.surfaceRaised,
                  }}
                />
              ))}
            </div>
            <span style={{ fontFamily: TOKENS.fontMono, fontSize: "9.5px", color: TOKENS.textPrimary, minWidth: "52px", textAlign: "right" }}>
              {c.logit.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function GenerationPanel() {
  const meta = useStore((s) => s.genMeta);
  const opIndex = useStore((s) => s.opIndex);
  const stepOp = useStore((s) => s.stepOp);
  const status = useStore((s) => s.genStatus);
  const frame = useStore((s) => (s.playIndex >= 0 ? s.genFrames[s.playIndex] : null));
  const genDone = useStore((s) => s.genDone);

  const catalog = meta?.op_catalog ?? [];
  const nLayers = meta?.num_layers ?? 0;
  const op = catalog.length ? catalog[Math.min(opIndex, catalog.length - 1)] : null;
  const activeLayer = activeLayerOf(op ?? undefined, nLayers);
  const phase = phaseInfo(frame, meta?.prompt_len ?? 0, meta?.uses_kv_cache);

  const NA = "UNAVAILABLE";

  if (!frame && (!meta || catalog.length === 0)) {
    return (
      <div className="rightpanel">
        <div className="rp-empty">
          {status === "streaming"
            ? "streaming a real generation…"
            : "Ready to run inference. Enter a prompt and press GENERATE."}
        </div>
      </div>
    );
  }

  const timings = frame?.layer_timings_ms ?? [];
  const stepMs = timings.length ? timings.reduce((a, b) => a + b, 0) : null;
  const activeMs =
    timings.length && activeLayer != null
      ? timings[Math.max(0, Math.min(activeLayer, timings.length - 1))]
      : null;
  const cacheLen = frame?.cache_len ?? phase?.cacheLen ?? null;
  const nPos = frame?.n_positions ?? phase?.positions ?? null;
  const dp = meta?.decoding_params ?? {};

  // Issue #297 — needle probe: locate the [MEMORY] fact inside the tokenized
  // prompt and (for sliding-window runs) decide honestly whether it is still
  // inside the window once generation finished. `prompt_len` alone cannot tell
  // that — the needle may sit anywhere in the prompt.
  const needleText = genDone?.needle_report?.needle ?? dp.needle ?? null;
  const needleSpan = findNeedleSpan(meta?.prompt_tokens ?? [], needleText);
  const needleTotal = (meta?.prompt_len ?? 0) + (genDone?.total_steps ?? 0);
  const needleRes = needleResidency(needleSpan, needleTotal, dp.window_size ?? null);
  // Sliding-window state straight from the frame's own trim flag.
  const winState = windowState(cacheLen, dp.window_size ?? null, frame?.cache_trimmed);
  const tokenText = frame?.chosen.text ?? "";

  return (
    <div className="rightpanel genpanel" style={{ overflowY: "auto" }}>
      {/* Header: mode + phase */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontFamily: TOKENS.fontSans, fontSize: "11px", letterSpacing: "0.1em", color: TOKENS.textPrimary }}>
          GENERATION INSPECTOR
        </span>
        {phase && (
          <span
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: "9px",
              letterSpacing: "0.08em",
              padding: "2px 7px",
              borderRadius: TOKENS.radiusSm,
              border: `1px solid ${phase.phase === "prefill" ? "#3a3a6a" : "#2a3a4a"}`,
              color: phase.phase === "prefill" ? "#b8b8ff" : "#9fd0f0",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            {phase.label.toUpperCase()}
          </span>
        )}
      </div>

      {/* CURRENT TOKEN */}
      <div style={sectStyle}>
        <SectionTitle title="CURRENT TOKEN" />
        <div
          style={{
            fontFamily: TOKENS.fontMono,
            fontSize: "20px",
            lineHeight: 1.25,
            color: "#7fd7c8",
            padding: "6px 0",
            wordBreak: "break-word",
          }}
        >
          {tokenText.replace(/\n/g, "⏎") || "␣"}
        </div>
        <div style={rowStyle}><span style={keyStyle}>TOKEN ID</span><span style={valStyle}>{frame?.chosen.id ?? NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>STEP</span><span style={valStyle}>{frame?.step != null ? frame.step + 1 : NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>PHASE</span><span style={valStyle}>{phase?.phase ?? NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>LOGPROB</span><span style={valStyle}>{frame?.chosen.logprob != null ? frame.chosen.logprob.toFixed(4) : NA}</span></div>
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={keyStyle}>SELECTION</span>
          <span style={{ ...valStyle, color: "#9fd0f0" }}>
            {frame?.sampled == null ? "—" : frame.sampled ? "sampled" : "argmax"}
          </span>
        </div>
        {phase && (
          <div
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: "9px",
              color: TOKENS.textMuted,
              lineHeight: 1.4,
              paddingTop: "4px",
            }}
          >
            {phase.detail}
          </div>
        )}
      </div>

      {/* TOP PREDICTIONS */}
      {frame?.topk?.length ? (
        <div style={sectStyle}>
          <SectionTitle title="TOP PREDICTIONS" right={`top ${frame.topk.length}`} />
          <Predictions topk={frame.topk} />
        </div>
      ) : (
        <div style={sectStyle}>
          <SectionTitle title="TOP PREDICTIONS" />
          <div style={{ ...keyStyle, padding: "2px 0" }}>{NA}</div>
        </div>
      )}

      {/* LOGITS */}
      {frame?.topk?.length ? (
        <div style={sectStyle}>
          <SectionTitle title="LOGITS" right="real" />
          <Logits topk={frame.topk} />
        </div>
      ) : (
        <div style={sectStyle}>
          <SectionTitle title="LOGITS" />
          <div style={{ ...keyStyle, padding: "2px 0" }}>{NA}</div>
        </div>
      )}

      {/* KV CACHE */}
      <div style={sectStyle}>
        <SectionTitle title="KV CACHE" right={meta?.uses_kv_cache ? "active" : "n/a"} />
        <div style={rowStyle}><span style={keyStyle}>CACHE LEN</span><span style={valStyle}>{cacheLen != null ? cacheLen : NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>POSITIONS</span><span style={valStyle}>{nPos != null ? nPos : NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>PROMPT LEN</span><span style={valStyle}>{meta?.prompt_len != null ? meta.prompt_len : NA}</span></div>
        {/* Sliding-window mode: the configured window size plus the honest
            cache state. `winState` comes from windowState() driven by the
            frame's `cache_trimmed` flag — a merely-full window is NOT trimming
            (the backend's trim test is strict `>`). */}
        {meta?.decoding === "sliding_window" && dp.window_size != null && (
          <div style={rowStyle}>
            <span style={keyStyle}>WINDOW SIZE</span>
            <span style={{ ...valStyle, color: winState === "trimming" ? "#ffd36e" : winState === "full" ? "#ffb347" : TOKENS.textSecondary }}>
              {dp.window_size}
              {winState === "trimming" ? " · trimming" : winState === "full" ? " · full" : " · growing"}
            </span>
          </div>
        )}
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={keyStyle}>CONTEXT</span>
          {/* CONTEXT = positions the model attended over on this frame's
              forward pass: the KV cache it reused (cache_len) plus the
              positions computed now (n_positions).
              prefill → 0 + prompt_len · decode → cache_len + 1 ·
              sliding-window after a trim → window_size + 1. */}
          <span style={valStyle}>{attendedPositions(cacheLen, nPos) ?? NA}</span>
        </div>
      </div>

      {/* SPECULATIVE DECODING — only when spec fields are present on the frame */}
      {frame?.n_accepted != null && (
        <div style={sectStyle}>
          <SectionTitle title="SPECULATIVE DECODING" right="real" />
          <div style={rowStyle}>
            <span style={keyStyle}>ACCEPTED</span>
            <span style={{ ...valStyle, color: "#7fd7c8" }}>{frame.n_accepted}</span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>DRAFT POSITION</span>
            {/* draft_pos: 0-based index of this token in the emitted batch.
                draft_pos < n_accepted  → accepted draft token (orange)
                draft_pos == n_accepted → target continuation (gold) */}
            <span style={{ ...valStyle, color: frame.spec_cont ? "#ffd36e" : "#ff9f43" }}>
              {frame.draft_pos != null ? frame.draft_pos : "—"}
              {frame.spec_cont === false ? " (draft)" : frame.spec_cont === true ? " (target)" : ""}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>IS CONTINUATION</span>
            <span style={{ ...valStyle, color: frame.spec_cont ? "#ffd36e" : TOKENS.textSecondary }}>
              {frame.spec_cont == null ? "—" : frame.spec_cont ? "yes" : "no"}
            </span>
          </div>
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <span style={keyStyle}>SPEC BATCH</span>
            <span style={valStyle}>
              {frame.draft_batch ? "yes" : "—"}
            </span>
          </div>
        </div>
      )}
      {/* Run-level spec summary — shown after generation completes */}
      {genDone?.drafts_accepted != null && genDone.draft_batches != null && (
        <div style={sectStyle}>
          <SectionTitle title="SPEC SUMMARY" right="run total" />
          <div style={rowStyle}>
            <span style={keyStyle}>DRAFTS PROPOSED</span>
            <span style={valStyle}>
              {(genDone.drafts_proposed ?? (genDone.draft_batches * (meta?.decoding_params?.draft_gamma ?? 4)))}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>DRAFTS ACCEPTED</span>
            <span style={{ ...valStyle, color: "#7fd7c8" }}>{genDone.drafts_accepted}</span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>DRAFTS REJECTED</span>
            <span style={{ ...valStyle, color: "#ff6b6b" }}>
              {(genDone.drafts_rejected ?? ((genDone.draft_batches * (meta?.decoding_params?.draft_gamma ?? 4)) - genDone.drafts_accepted))}
            </span>
          </div>
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <span style={keyStyle}>ACCEPTANCE RATE</span>
            <span style={{ ...valStyle, color: "#7fd7c8" }}>
              {genDone.acceptance_rate != null ? `${(genDone.acceptance_rate * 100).toFixed(1)}%` : NA}
            </span>
          </div>
        </div>
      )}

      {/* NEEDLE RECALL — shown after generation when needle was enabled.
          needle_report lives on the done frame; the needle's POSITION is
          derived from the real tokenized prompt (meta.prompt_tokens), and its
          residency compares that span against the sliding window using
          prompt_len + total_steps (the backend's net KV position count). No
          eviction is inferred from prompt_len alone. */}
      {genDone?.needle_report && (
        <div style={sectStyle}>
          <SectionTitle title="NEEDLE RECALL" right={genDone.needle_report.recalled ? "✓ recalled" : "✗ missed"} />
          <div style={rowStyle}>
            <span style={keyStyle}>NEEDLE</span>
            <span style={{ ...valStyle, color: TOKENS.textSecondary, maxWidth: "130px" }}>
              {genDone.needle_report.needle}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>POSITION</span>
            <span style={{ ...valStyle, color: needleSpan ? "#55efc4" : TOKENS.textMuted }}>
              {needleSpan ? `${needleSpan.start}–${needleSpan.end}` : "not located"}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>PROMPT LENGTH</span>
            <span style={valStyle}>{meta?.prompt_len ?? NA}</span>
          </div>
          {meta?.decoding === "sliding_window" && dp.window_size != null && (
            <div style={rowStyle}>
              <span style={keyStyle}>WINDOW SIZE</span>
              <span style={valStyle}>{dp.window_size}</span>
            </div>
          )}
          {meta?.decoding === "sliding_window" && needleRes != null && (
            <div style={rowStyle}>
              <span style={keyStyle}>STILL ATTENDED</span>
              <span style={{ ...valStyle, color: needleRes.evicted ? "#ff6b6b" : "#7fd7c8" }}>
                {needleRes.evicted
                  ? `no · window starts at ${needleRes.keptFrom}`
                  : "yes · inside the window"}
              </span>
            </div>
          )}
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <span style={keyStyle}>RECALLED</span>
            <span style={{ ...valStyle, color: genDone.needle_report.recalled ? "#7fd7c8" : "#ff6b6b", fontWeight: 600 }}>
              {genDone.needle_report.recalled ? "yes" : "no"}
            </span>
          </div>
        </div>
      )}

      {/* OPERATION */}
      <div style={sectStyle}>
        <SectionTitle title="OPERATION" right={op ? `op ${opIndex + 1} / ${catalog.length}` : undefined} />
        {op ? (
          <div>
            <div style={rowStyle}>
              <span style={keyStyle}>CURRENT</span>
              <span style={{ ...valStyle, fontSize: "11px" }}>
                {op.layer != null && op.layer >= 0 && op.layer < nLayers
                  ? `L${op.layer} · ${op.op_key}`
                  : op.op_key}
              </span>
            </div>
            <div style={rowStyle}>{op.label}</div>
            {activeLayer != null && (
              <div style={rowStyle}><span style={keyStyle}>LAYER IDX</span><span style={valStyle}>{activeLayer}</span></div>
            )}
            <div style={{ ...rowStyle, borderBottom: "none", justifyContent: "flex-end", gap: "4px" }}>
              <Button onClick={() => stepOp(-1)} disabled={opIndex <= 0} style={{ height: "20px", padding: "0 8px", fontSize: "10px" }}>‹ Prev</Button>
              <Button onClick={() => stepOp(1)} disabled={opIndex >= catalog.length - 1} style={{ height: "20px", padding: "0 8px", fontSize: "10px" }}>Next ›</Button>
            </div>
          </div>
        ) : (
          <div style={{ ...keyStyle, padding: "2px 0" }}>{NA} — no op catalog (e.g. llama.cpp)</div>
        )}
      </div>

      {/* TIMING */}
      <div style={sectStyle}>
        <SectionTitle title="TIMING" />
        <div style={rowStyle}><span style={keyStyle}>STEP TOTAL</span><span style={valStyle}>{stepMs != null ? `${stepMs.toFixed(1)} ms` : NA}</span></div>
        {activeLayer != null && (
          <div style={rowStyle}>
            <span style={keyStyle}>ACTIVE LAYER</span>
            <span style={valStyle}>{activeMs != null ? `${activeMs.toFixed(2)} ms` : NA}</span>
          </div>
        )}
      </div>

      {/* DECODE PARAMS — real parameters this run used. */}
      <div style={{ ...sectStyle, borderTop: `1px solid ${TOKENS.border}`, marginTop: "10px", paddingTop: "6px" }}>
        <SectionTitle title="DECODE PARAMS" />
        <div style={rowStyle}><span style={keyStyle}>MODE</span><span style={valStyle}>{meta?.decoding ?? NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>TEMPERATURE</span><span style={valStyle}>{dp.temperature != null ? dp.temperature.toFixed(2) : NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>TOP-K</span><span style={valStyle}>{dp.top_k ?? meta?.top_k ?? NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>TOP-P</span><span style={valStyle}>{dp.top_p != null ? dp.top_p.toFixed(2) : NA}</span></div>
        <div style={rowStyle}><span style={keyStyle}>MAX TOKENS</span><span style={valStyle}>{meta?.max_new_tokens ?? NA}</span></div>
      </div>
    </div>
  );
}