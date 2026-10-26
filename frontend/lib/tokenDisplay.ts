import type { TokenFrame } from "./types";
import { specTokenKind } from "./specDecoding";

/**
 * Issue #297 — Shared token classification and styling for all token strips.
 *
 * Returns CSS class name for a generated token based on its speculative
 * decoding status. Used by both TokenStrip (sidebar) and BottomBar (3D view).
 */
export function tokenClass(frame: TokenFrame, isLast: boolean): string {
  const kind = specTokenKind(frame);
  const base = kind ? `tok gen ${kind}` : "tok gen";
  return base + (isLast ? " last" : "");
}

/**
 * Returns inline style object for tokens in the BottomBar.
 * Maps the same draft/target/prefill logic to inline styles.
 */
export function tokenStyle(frame: TokenFrame, isLast: boolean): {
  color: string;
  fontWeight?: number;
  opacity?: number;
} {
  const kind = specTokenKind(frame);
  
  if (kind === "draft") {
    return {
      color: "#ff9f43", // orange for accepted draft
      fontWeight: isLast ? 600 : 400,
    };
  }
  
  if (kind === "target") {
    return {
      color: "#ffd36e", // gold for target continuation
      fontWeight: isLast ? 600 : 400,
    };
  }
  
  // Non-speculative tokens (greedy/sampling) or prefill
  return {
    color: isLast ? "#ffffff" : "#a0a0b0",
    fontWeight: isLast ? 600 : 400,
  };
}
