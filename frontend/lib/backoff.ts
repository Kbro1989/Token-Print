/**
 * Exponential backoff for polling a backend that may still be starting up:
 * 1s, 2s, 4s, 8s, then capped at `maxMs` (15s by default).
 */
export function backoffDelayMs(attempt: number, baseMs = 1000, maxMs = 15_000): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, baseMs * 2 ** Math.min(n, 30));
}
