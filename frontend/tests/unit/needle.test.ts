import assert from "node:assert/strict";
import test from "node:test";
import { findNeedleSpan, needleResidency } from "../../lib/genReadouts";

/**
 * Issue #297 — needle probe readouts.
 *
 * The backend injects the probe verbatim as `[MEMORY] {needle}\n\n[QUERY] …`,
 * so the needle's token span is discoverable from `meta.prompt_tokens`, and its
 * residency can be decided from the real position count (`prompt_len +
 * done.total_steps`) against the sliding window — never from `prompt_len`
 * alone (PR #380 review).
 */

const PROMPT = [
  "<|im_start|>",
  "[MEMORY]",
  "The",
  "capital",
  " of",
  " France",
  " is",
  " Par",
  "is",
  "\n\n",
  "[QUERY",
  "]",
  " Where",
  " is",
  " it",
  "?",
];

test("locates the needle's token span from the tokenized prompt", () => {
  const span = findNeedleSpan(PROMPT, "capital of France is Paris");
  assert.ok(span, "span must be found");
  // Tokens 3..8 inclusive spell "capital of France is Paris" (" Par" + "is");
  // the span is half-open, so it ends at the first token AFTER the match.
  assert.equal(span!.start, 3);
  assert.equal(span!.end, 9); // exclusive
});

test("match is case-insensitive and trimmed", () => {
  const span = findNeedleSpan(PROMPT, "  CAPITAL of france is paris  ");
  assert.ok(span);
  assert.equal(span!.start, 3);
  assert.equal(span!.end, 9);
});

test("returns null when the needle is absent instead of guessing", () => {
  assert.equal(findNeedleSpan(PROMPT, "Berlin is the capital"), null);
});

test("returns null for empty needle or empty prompt", () => {
  assert.equal(findNeedleSpan(PROMPT, ""), null);
  assert.equal(findNeedleSpan(PROMPT, "   "), null);
  assert.equal(findNeedleSpan([], "anything"), null);
  assert.equal(findNeedleSpan(PROMPT, null), null);
});

test("needle at the very start of the prompt still maps correctly", () => {
  const span = findNeedleSpan(["[MEMORY]", " 42", " is", " the", " answer"], "42 is the answer");
  assert.deepEqual(span, { start: 1, end: 5 });
});

// --- Residency against the sliding window ---------------------------------- //

test("needle stays attended while the whole sequence fits the window", () => {
  const span = { start: 3, end: 8 };
  const res = needleResidency(span, 100, 512);
  assert.ok(res);
  assert.equal(res!.evicted, false);
  assert.equal(res!.keptFrom, 0);
});

test("needle is evicted once the window start passes its last token", () => {
  const span = { start: 3, end: 8 };
  // 1000 positions fed, window 64 → kept range [936, 1000): span long gone.
  const res = needleResidency(span, 1000, 64);
  assert.ok(res);
  assert.equal(res!.keptFrom, 936);
  assert.equal(res!.evicted, true);
});

test("needle ending exactly at the window start counts as evicted", () => {
  const span = { start: 3, end: 8 };
  // keptFrom = 8 → positions 0..7 are gone.
  const res = needleResidency(span, 8 + 64, 64);
  assert.ok(res);
  assert.equal(res!.keptFrom, 8);
  assert.equal(res!.evicted, true);
});

test("needle overlapping the window start is still attended", () => {
  const span = { start: 3, end: 8 };
  const res = needleResidency(span, 8 + 64 - 1, 64); // keptFrom = 7
  assert.ok(res);
  assert.equal(res!.keptFrom, 7);
  assert.equal(res!.evicted, false);
});

test("missing inputs produce no verdict rather than a wrong one", () => {
  assert.equal(needleResidency(null, 1000, 64), null);
  assert.equal(needleResidency({ start: 0, end: 4 }, 0, 64), null);
  assert.equal(needleResidency({ start: 0, end: 4 }, null, 64), null);
  assert.equal(needleResidency({ start: 0, end: 4 }, 1000, undefined), null);
  assert.equal(needleResidency({ start: 0, end: 4 }, 1000, 0), null);
});
