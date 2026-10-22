"use client";

import { useEffect } from "react";
import { fetchHealth } from "./api";
import { backoffDelayMs } from "./backoff";
import { useStore } from "./store";
import type { ArchitectureSlice } from "./store/types";

/**
 * Sync the store's `modelMode` from GET /health (issue #87).
 *
 * The backend's model family (causal_lm / encoder / vision) is fixed for the
 * life of the server, so one successful read is enough. Without this,
 * `modelMode` is only learned after the first sentence analysis, and
 * mode-specific UI (e.g. the encoder similarity widget, issue #298) would stay
 * hidden until then.
 *
 * The backend may still be loading its model when the page opens, so a failed
 * read or one without a `mode` is retried with exponential backoff (1s, 2s,
 * 4s… capped at 15s) until it succeeds or the component unmounts.
 */
export function useBackendModelMode(): void {
  const setModelMode = useStore((s) => s.setModelMode);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (n: number) => {
      const h = await fetchHealth(); // never throws; returns no mode on failure
      if (!alive) return;
      if (h.mode) {
        setModelMode(h.mode as ArchitectureSlice["modelMode"]);
        return;
      }
      timer = setTimeout(() => void attempt(n + 1), backoffDelayMs(n));
    };
    void attempt(0);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [setModelMode]);
}
