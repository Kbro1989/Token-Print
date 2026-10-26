import type { TokenFrame } from "./types";

/**
 * Per-layer timing view for the TimingReadout panel (issues #18, #101).
 *
 * - `real`  — wall-clock ms per layer, measured by the backend's per-layer
 *             forward hooks (`frame.layer_timings_ms`).
 * - `proxy` — the frame carries no timings (e.g. a trace recorded before they
 *             existed), so we fall back to mean |activation| per layer from
 *             `frame.layer_stats`. It is unitless and NOT a latency: `total`
 *             is null so callers cannot render it as milliseconds.
 */
export type LayerTimingKind = "real" | "proxy";

export interface LayerTimingView {
  kind: LayerTimingKind;
  perLayer: number[];
  /** Sum of per-layer ms. Null for proxy — activation norms don't add up to a time. */
  total: number | null;
  /** Bar-scale denominator (> 0). */
  max: number;
}

export function layerTimingView(
  frame: TokenFrame | null,
  fallbackFrame: TokenFrame | null,
  numLayers: number | undefined,
): LayerTimingView | null {
  const rawTimings = frame?.layer_timings_ms;
  const timings = Array.isArray(rawTimings)
    ? rawTimings.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : undefined;
  if (timings && timings.length > 0) {
    const total = timings.reduce((a, b) => a + b, 0);
    return {
      kind: "real",
      perLayer: timings,
      total: Number.isFinite(total) ? total : null,
      // Bars scale to at least 1 ms so sub-ms layers don't all look "hot".
      max: Math.max(...timings, 1),
    };
  }

  if (typeof numLayers !== "number" || !Number.isFinite(numLayers) || numLayers <= 0) return null;
  const rawStats = frame?.layer_stats ?? fallbackFrame?.layer_stats;
  const stats = Array.isArray(rawStats)
    ? rawStats.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : undefined;
  if (!stats || stats.length === 0) return null;
  // Live frames build layer_stats from hidden_states: num_layers + 1 entries,
  // entry 0 being the embedding output. Older traces may carry exactly
  // num_layers. Taking the last num_layers keeps one value per layer for both.
  const perLayer = stats.slice(-numLayers);
  return {
    kind: "proxy",
    perLayer,
    total: null,
    max: Math.max(...perLayer, Number.MIN_VALUE),
  };
}
