import assert from "node:assert/strict";
import test from "node:test";

/**
 * Issue #297 — Acceptance rate calculation.
 *
 * Formula: drafts_accepted / (draft_batches * draft_gamma)
 *
 * Proposed = draft_batches * draft_gamma (total drafts generated)
 * Accepted = drafts_accepted
 * Rejected = proposed - accepted
 * Rate = accepted / proposed
 */

test("acceptance rate with gamma=2, 10 batches, 8 accepted", () => {
  const draft_batches = 10;
  const draft_gamma = 2;
  const drafts_accepted = 8;

  const proposed = draft_batches * draft_gamma; // 20
  const rejected = proposed - drafts_accepted;   // 12
  const rate = drafts_accepted / proposed;        // 0.4

  assert.equal(proposed, 20);
  assert.equal(rejected, 12);
  assert.equal(rate, 0.4);
});

test("acceptance rate with gamma=3, 10 batches, 8 accepted gives 26.7%", () => {
  const draft_batches = 10;
  const draft_gamma = 3;
  const drafts_accepted = 8;

  const proposed = draft_batches * draft_gamma; // 30
  const rate = drafts_accepted / proposed;       // 8/30 = 0.2666...

  assert.equal(proposed, 30);
  assert.equal(Math.round(rate * 1000) / 10, 26.7); // 26.7%
});

test("acceptance rate with gamma=4, 10 batches, 8 accepted", () => {
  const draft_batches = 10;
  const draft_gamma = 4;
  const drafts_accepted = 8;

  const proposed = draft_batches * draft_gamma; // 40
  const rate = drafts_accepted / proposed;       // 0.2

  assert.equal(proposed, 40);
  assert.equal(rate, 0.2);
});

test("100% acceptance when all drafts accepted", () => {
  const draft_batches = 5;
  const draft_gamma = 3;
  const drafts_accepted = 15; // all proposed

  const proposed = draft_batches * draft_gamma;
  const rate = drafts_accepted / proposed;

  assert.equal(rate, 1.0);
});

test("0% acceptance when no drafts accepted", () => {
  const draft_batches = 10;
  const draft_gamma = 2;
  const drafts_accepted = 0;

  const proposed = draft_batches * draft_gamma;
  const rate = drafts_accepted / proposed;

  assert.equal(rate, 0);
});
