/**
 * Issue #297 — shared, unit-tested arithmetic for the decode-mode readouts.
 *
 * Every function here is pure and fed exclusively by values the backend
 * actually emitted (`frame.cache_len`, `frame.n_positions`, `frame.step`,
 * `meta.prompt_tokens`, `meta.decoding_params`, `done.total_steps`), so the
 * inspector panel and the 3D overlays show the same numbers instead of each
 * inventing its own.
 */

/**
 * Positions the model ATTENDED over on a frame's forward pass: the KV cache it
 * reused (`cache_len`) plus the positions it computed in this step
 * (`n_positions`).
 *
 * - prefill: 0 cached + prompt_len computed  → prompt_len
 * - decode:  cache_len cached + 1 computed   → cache_len + 1
 * - sliding-window after a trim: window_size + 1
 *
 * `cache_len` alone is the *cache* size (it is 0 on the prefill frame), which
 * is why CONTEXT must not display it bare — see PR #380 review.
 */
export function attendedPositions(
  cacheLen: number | null | undefined,
  nPositions: number | null | undefined,
): number | null {
  if (cacheLen == null) return null;
  if (nPositions == null) return cacheLen;
  return cacheLen + nPositions;
}

export type WindowState = "growing" | "full" | "trimming";

/**
 * Honest sliding-window state.
 *
 * The backend trims only when `positions_done > window_size`, so a cache that
 * is exactly `window_size` long has NOT been trimmed yet — labelling that frame
 * "trimming oldest" was a false alarm (PR #380 review). `trimmed` comes straight
 * from the frame's `cache_trimmed` flag, which the backend sets only in the
 * branch that really called `trim_cache()`.
 */
export function windowState(
  cacheLen: number | null | undefined,
  windowSize: number | null | undefined,
  trimmed: boolean | undefined,
): WindowState {
  if (trimmed) return "trimming";
  if (cacheLen != null && windowSize != null && cacheLen >= windowSize) return "full";
  return "growing";
}

/** Half-open token-index range `[start, end)` the needle occupies in the prompt. */
export interface NeedleSpan {
  start: number;
  end: number;
}

/**
 * Locate the needle inside the tokenized prompt.
 *
 * The backend injects the probe verbatim (`[MEMORY] {needle}\n\n[QUERY] …`),
 * so the concatenation of the per-token decodes contains the needle text. We
 * map the character range back onto token indices; if tokenization mangled the
 * text beyond recognition we return `null` rather than guessing a position.
 */
export function findNeedleSpan(
  promptTokens: string[],
  needle: string | null | undefined,
): NeedleSpan | null {
  const query = (needle ?? "").trim().toLowerCase();
  if (!query || promptTokens.length === 0) return null;

  const starts: number[] = [];
  let joined = "";
  for (const t of promptTokens) {
    starts.push(joined.length);
    joined += t;
  }
  const hit = joined.toLowerCase().indexOf(query);
  if (hit < 0) return null;
  const hitEnd = hit + query.length;

  let start = 0;
  while (start + 1 < starts.length && starts[start + 1] <= hit) start += 1;
  let end = start;
  while (end < promptTokens.length && starts[end] < hitEnd) end += 1;
  if (end <= start) return null;
  return { start, end };
}

export interface NeedleResidency {
  /** True when every needle token has fallen out of the sliding window. */
  evicted: boolean;
  /** Oldest position still resident in the trimmed cache. */
  keptFrom: number;
}

/**
 * Where the needle sits relative to the sliding window once `totalPositions`
 * positions have been fed.
 *
 * `totalPositions` is `prompt_len + done.total_steps` (the backend's net KV
 * position count: every emitted token corresponds to exactly one position),
 * and the trimmed cache keeps the newest `windowSize` positions, i.e. indices
 * `[totalPositions - windowSize, totalPositions)`. The needle is still
 * re-attended to while any of its tokens lies inside that range.
 */
export function needleResidency(
  span: NeedleSpan | null,
  totalPositions: number | null | undefined,
  windowSize: number | null | undefined,
): NeedleResidency | null {
  if (!span) return null;
  if (totalPositions == null || !(totalPositions > 0)) return null;
  if (windowSize == null || !(windowSize > 0)) return null;
  const keptFrom = Math.max(0, totalPositions - windowSize);
  return { evicted: span.end <= keptFrom, keptFrom };
}

/**
 * Fraction (0..1) of the sequence covered by the live KV window on a frame:
 * attended positions over everything seen so far. Used by the sliding-window
 * bar in the 3D scene.
 */
export function windowFraction(
  cacheLen: number | null | undefined,
  nPositions: number | null | undefined,
  totalPositions: number | null | undefined,
): number {
  const attended = attendedPositions(cacheLen, nPositions);
  if (attended == null || totalPositions == null || totalPositions <= 0) return 0;
  return Math.min(attended / totalPositions, 1);
}
