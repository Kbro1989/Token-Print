import type { TokenFrame } from "./types";

/**
 * Issue #297 — classification of a generated token produced by the speculative
 * decoding branch.
 *
 * The backend (backend/app/model.py) accepts `k` drafts, then always emits one
 * extra token from the target model. Every token in that emitted batch carries:
 *
 *   n_accepted  – k, the number of drafts accepted this step
 *   draft_pos   – g, this token's 0-based index inside the batch (0..k)
 *   spec_cont   – g >= k, i.e. true only for the target continuation token
 *   draft_batch – true, a draft batch was proposed this step
 *   accepted_drafts – true, this frame came from the speculative branch
 *
 * Frames from greedy/sampling runs carry none of these keys.
 */
export type SpecTokenKind = "draft" | "target" | null;

export function specTokenKind(frame: TokenFrame): SpecTokenKind {
  if (frame.accepted_drafts !== true) return null;
  return frame.spec_cont === true ? "target" : "draft";
}

/** Human-readable label for a token's origin; empty for non-speculative runs. */
export function specTokenLabel(frame: TokenFrame): string {
  const kind = specTokenKind(frame);
  if (kind === null) return "";
  if (kind === "target") return "target continuation token";
  const n = frame.n_accepted ?? 0;
  const pos = (frame.draft_pos ?? 0) + 1;
  return `accepted draft (${pos} of ${n})`;
}

/**
 * True when a frame's annotations are self-consistent. Guards against a future
 * backend change silently breaking the UI: draft_pos must fall inside the
 * emitted batch (0..n_accepted) and spec_cont must agree with draft_pos.
 */
export function isSpecFrameConsistent(frame: TokenFrame): boolean {
  if (frame.accepted_drafts !== true) return true;
  const n = frame.n_accepted;
  const pos = frame.draft_pos;
  if (typeof n !== "number" || typeof pos !== "number") return false;
  if (pos < 0 || pos > n) return false;
  return frame.spec_cont === (pos >= n);
}
