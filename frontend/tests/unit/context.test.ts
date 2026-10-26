import assert from "node:assert/strict";
import test from "node:test";
import { attendedPositions, windowFraction, windowState } from "../../lib/genReadouts";

/**
 * Issue #297 — CONTEXT / window readouts must be computed from the REAL frame
 * fields via the production helper (`lib/genReadouts.ts`), the same function
 * GenerationPanel and the 3D SlidingWindowBar render with. The previous version
 * of this test asserted against a local identity function and therefore never
 * exercised the shipped code (PR #380 review).
 *
 * CONTEXT = cache_len + n_positions: the positions the model attended over on
 * that forward pass (the reused KV cache plus the positions computed now).
 */

test("prefill frame attends over the whole prompt, not 0", () => {
  // cache_len = 0 (nothing cached before prefill), n_positions = prompt_len.
  assert.equal(attendedPositions(0, 40), 40);
});

test("decode frame attends over cache plus the new position", () => {
  assert.equal(attendedPositions(40, 1), 41);
  assert.equal(attendedPositions(41, 1), 42);
});

test("sliding-window frame after a trim attends over window_size + 1", () => {
  assert.equal(attendedPositions(32, 1), 33);
});

test("missing n_positions falls back to the cache length", () => {
  assert.equal(attendedPositions(17, null), 17);
  assert.equal(attendedPositions(17, undefined), 17);
});

test("missing cache_len is unavailable, never 0", () => {
  assert.equal(attendedPositions(null, 1), null);
  assert.equal(attendedPositions(undefined, 1), null);
});

test("the old prompt_len + cache_len double count is gone", () => {
  const promptLen = 10;
  const cacheLenOnFirstDecode = 10; // cache already includes the prompt
  // The historical bug displayed promptLen + cacheLen = 20 (prompt counted twice).
  assert.equal(attendedPositions(cacheLenOnFirstDecode, 1), 11);
  assert.notEqual(attendedPositions(cacheLenOnFirstDecode, 1), promptLen + cacheLenOnFirstDecode);
});

// --- Sliding-window state --------------------------------------------------- //

test("a cache that merely reached the window is FULL, not trimming", () => {
  // The backend trims only on a strict `positions_done > window_size`, so the
  // boundary frame must not be labelled as an active trim (PR #380 review).
  assert.equal(windowState(32, 32, false), "full");
  assert.equal(windowState(32, 32, undefined), "full");
});

test("only the frame's cache_trimmed flag reports trimming", () => {
  assert.equal(windowState(32, 32, true), "trimming");
  assert.equal(windowState(31, 32, true), "trimming"); // flagged trim wins
  assert.equal(windowState(31, 32, false), "growing");
  assert.equal(windowState(0, 32, false), "growing");
});

test("window fraction caps at 1 and guards degenerate input", () => {
  assert.equal(windowFraction(0, 40, 40), 1); // prefill: everything attended
  assert.equal(windowFraction(10, 1, 100), 0.11);
  assert.equal(windowFraction(500, 1, 100), 1); // clamped, never > 1
  assert.equal(windowFraction(null, 1, 100), 0);
  assert.equal(windowFraction(10, 1, 0), 0); // no division by zero
});
