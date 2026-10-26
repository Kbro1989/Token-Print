/**
 * Pure helpers for the prompt-level embedding similarity view (issue #298).
 * Kept free of React so they can be unit-tested without a browser.
 */

export const MIN_SIMILARITY_SENTENCES = 2;
/** Mirrors MAX_SIMILARITY_SENTENCES in backend/app/schemas.py. */
export const MAX_SIMILARITY_SENTENCES = 8;

/** One sentence per line; blank lines and surrounding whitespace are dropped. */
export function parseSentences(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** A user-facing reason the list can't be submitted, or null when it's valid. */
export function sentenceCountError(sentences: string[]): string | null {
  if (sentences.length < MIN_SIMILARITY_SENTENCES) {
    return `Enter at least ${MIN_SIMILARITY_SENTENCES} sentences, one per line.`;
  }
  if (sentences.length > MAX_SIMILARITY_SENTENCES) {
    return `At most ${MAX_SIMILARITY_SENTENCES} sentences (you have ${sentences.length}).`;
  }
  return null;
}

/**
 * Min/max over the off-diagonal cells. The diagonal is always 1 and would
 * otherwise dominate the colour scale.
 */
export function offDiagonalRange(matrix: number[][]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i === j) continue;
      min = Math.min(min, matrix[i][j]);
      max = Math.max(max, matrix[i][j]);
    }
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/**
 * Shading for a cell in [0, 1], relative to the off-diagonal range. Encoder
 * cosine scores often bunch together (e.g. 0.70-0.95), so an absolute [-1, 1]
 * scale would make every cell look the same. The UI labels this as relative
 * and always prints the real value in the cell.
 */
export function shadeIntensity(value: number, range: { min: number; max: number } | null): number {
  if (!range) return 1;
  if (range.max - range.min < 1e-9) return 1;
  const t = (value - range.min) / (range.max - range.min);
  return Math.min(1, Math.max(0, t));
}

/** The off-diagonal pair with the highest similarity (i < j), or null. */
export function mostSimilarPair(matrix: number[][]): { i: number; j: number; value: number } | null {
  let best: { i: number; j: number; value: number } | null = null;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix[i].length; j++) {
      if (!best || matrix[i][j] > best.value) best = { i, j, value: matrix[i][j] };
    }
  }
  return best;
}
