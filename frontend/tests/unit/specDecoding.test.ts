import assert from "node:assert/strict";
import test from "node:test";
import type { TokenFrame } from "../../lib/types";
import {
  isSpecFrameConsistent,
  specTokenKind,
  specTokenLabel,
} from "../../lib/specDecoding";

/**
 * Issue #297 — speculative decoding annotations.
 *
 * The frame shapes below are copied from what the backend actually emits at
 * backend/app/model.py:1316-1320. They are deliberately scalars/booleans, not
 * arrays — an earlier revision of this UI typed draft_pos as number[] and
 * crashed the 3D scene with "draftPos.filter is not a function".
 */

function specFrame(g: number, k: number): TokenFrame {
  return {
    type: "token",
    step: g,
    chosen: { id: 100 + g, text: `t${g}`, logprob: -0.1 },
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

test("greedy frames carry no speculative annotation", () => {
  const frame: TokenFrame = {
    type: "token",
    step: 0,
    chosen: { id: 1, text: "a", logprob: -2 },
    topk: [],
    layer_stats: [],
    eos: false,
    sampled: false,
  };
  assert.equal(specTokenKind(frame), null);
  assert.equal(specTokenLabel(frame), "");
  assert.equal(isSpecFrameConsistent(frame), true);
});

test("draft positions below n_accepted are draft tokens", () => {
  for (let g = 0; g < 2; g += 1) {
    const frame = specFrame(g, 2);
    assert.equal(specTokenKind(frame), "draft");
    assert.equal(specTokenLabel(frame), `accepted draft (${g + 1} of 2)`);
    assert.equal(isSpecFrameConsistent(frame), true);
  }
});

test("the token at draft_pos == n_accepted is the target continuation", () => {
  const frame = specFrame(2, 2);
  assert.equal(frame.spec_cont, true);
  assert.equal(specTokenKind(frame), "target");
  assert.equal(specTokenLabel(frame), "target continuation token");
  assert.equal(isSpecFrameConsistent(frame), true);
});

test("every step emits exactly one target token", () => {
  for (const k of [0, 1, 3, 4]) {
    const batch = Array.from({ length: k + 1 }, (_, g) => specFrame(g, k));
    const kinds = batch.map(specTokenKind);
    assert.equal(kinds.filter((x) => x === "target").length, 1, `k=${k}`);
    assert.equal(kinds.filter((x) => x === "draft").length, k, `k=${k}`);
  }
});

test("zero accepted drafts still emits one target token", () => {
  const frame = specFrame(0, 0);
  assert.equal(frame.spec_cont, true);
  assert.equal(specTokenKind(frame), "target");
});

test("inconsistent frames are flagged", () => {
  // draft_pos outside the emitted batch 0..n_accepted
  assert.equal(isSpecFrameConsistent(specFrame(5, 2)), false);
  // spec_cont disagrees with draft_pos
  assert.equal(
    isSpecFrameConsistent({ ...specFrame(0, 2), spec_cont: true }),
    false,
  );
  // missing required annotation
  assert.equal(
    isSpecFrameConsistent({ ...specFrame(0, 2), n_accepted: undefined }),
    false,
  );
});
