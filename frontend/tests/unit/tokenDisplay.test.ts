import assert from "node:assert/strict";
import test from "node:test";
import type { TokenFrame } from "../../lib/types";
import { tokenClass, tokenStyle } from "../../lib/tokenDisplay";

/**
 * Issue #297 — Token strip coloring (sidebar + bottom bar).
 *
 * Both the sidebar TokenStrip and BottomBar render token strips. They must
 * visually differentiate draft vs target tokens via shared helpers.
 */

function prefillFrame(id: number, text: string): TokenFrame {
  return {
    type: "token",
    step: 0,
    chosen: { id, text, logprob: -0.5 },
    topk: [],
    layer_stats: [],
    eos: false,
    phase: "prefill",
  };
}

function draftFrame(g: number, k: number): TokenFrame {
  return {
    type: "token",
    step: g + 1,
    chosen: { id: 200 + g, text: `draft${g}`, logprob: -0.1 },
    topk: [],
    layer_stats: [],
    eos: false,
    accepted_drafts: true,
    draft_batch: true,
    n_accepted: k,
    draft_pos: g,
    spec_cont: g >= k,
  };
}

function targetFrame(k: number): TokenFrame {
  return {
    type: "token",
    step: k + 1,
    chosen: { id: 300, text: `target`, logprob: -0.2 },
    topk: [],
    layer_stats: [],
    eos: false,
    accepted_drafts: true,
    draft_batch: true,
    n_accepted: k,
    draft_pos: k,
    spec_cont: true,
  };
}

test("prefill frame renders as plain 'tok gen'", () => {
  const frame = prefillFrame(100, "Hello");
  assert.equal(tokenClass(frame, false), "tok gen");
  assert.equal(tokenClass(frame, true), "tok gen last");
});

test("draft frames render with 'tok gen draft' class", () => {
  for (let g = 0; g < 2; g += 1) {
    const frame = draftFrame(g, 2);
    assert.equal(tokenClass(frame, false), "tok gen draft");
    assert.equal(tokenClass(frame, true), "tok gen draft last");
  }
});

test("target frame renders with 'tok gen target' class", () => {
  const frame = targetFrame(2);
  assert.equal(tokenClass(frame, false), "tok gen target");
  assert.equal(tokenClass(frame, true), "tok gen target last");
});

test("tokenStyle applies orange color to draft tokens", () => {
  const frame = draftFrame(0, 2);
  const style = tokenStyle(frame, false);
  assert.equal(style.color, "#ff9f43"); // orange
});

test("tokenStyle applies gold color to target tokens", () => {
  const frame = targetFrame(2);
  const style = tokenStyle(frame, false);
  assert.equal(style.color, "#ffd36e"); // gold
});

test("tokenStyle applies white to non-speculative last token", () => {
  const frame = prefillFrame(100, "Hello");
  const style = tokenStyle(frame, true);
  assert.equal(style.color, "#ffffff");
  assert.equal(style.fontWeight, 600);
});

test("tokenStyle applies muted color to non-speculative non-last token", () => {
  const frame = prefillFrame(100, "Hello");
  const style = tokenStyle(frame, false);
  assert.equal(style.color, "#a0a0b0");
  assert.equal(style.fontWeight, 400);
});

test("last token styling applies to speculative tokens too", () => {
  const draftLast = tokenStyle(draftFrame(1, 2), true);
  assert.equal(draftLast.color, "#ff9f43");
  assert.equal(draftLast.fontWeight, 600);

  const targetLast = tokenStyle(targetFrame(2), true);
  assert.equal(targetLast.color, "#ffd36e");
  assert.equal(targetLast.fontWeight, 600);
});
