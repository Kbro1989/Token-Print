"use client";

import { useEffect } from "react";
import { fetchHealth } from "./api";
import { useStore } from "./store";
import type { ArchitectureSlice } from "./store/types";

/**
 * Sync the store's `modelMode` from GET /health once on mount (issue #87).
 *
 * The backend's model family (causal_lm / encoder / vision) is fixed for the
 * life of the server, so one read is enough. Without this, `modelMode` is only
 * learned after the first sentence analysis, and mode-specific UI (e.g. the
 * encoder similarity widget, issue #298) would stay hidden until then.
 */
export function useBackendModelMode(): void {
  const setModelMode = useStore((s) => s.setModelMode);

  useEffect(() => {
    let alive = true;
    fetchHealth()
      .then((h) => {
        if (alive && h.mode) setModelMode(h.mode as ArchitectureSlice["modelMode"]);
      })
      .catch(() => {
        /* backend unreachable — keep whatever mode we had */
      });
    return () => {
      alive = false;
    };
  }, [setModelMode]);
}
