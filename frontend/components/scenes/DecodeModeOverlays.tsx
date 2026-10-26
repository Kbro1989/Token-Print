"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";

import { useStore } from "@/lib/store";
import {
  attendedPositions,
  findNeedleSpan,
  windowFraction,
  windowState,
  type NeedleSpan,
} from "@/lib/genReadouts";

/**
 * Issue #297 — decode-mode visuals for the generation scene.
 *
 * Three fixed viewport overlays, each driven exclusively by real frame/meta
 * values streamed from the backend:
 *
 *   • SpeculativeReadout  — top-right: drafts accepted this step (k/γ), plus
 *     whether the visible token is an accepted draft or the target's own
 *     continuation token.
 *   • SlidingWindowBar    — bottom: the live KV window over everything seen so
 *     far, the trim boundary (only when the backend really trimmed — see
 *     `cache_trimmed`), and the needle's span with its in-window/evicted state.
 *   • NeedleRecallBanner  — top-left: the done-frame recall verdict.
 *
 * Mounted by GenerationScene (the scene the generation workspace renders) so a
 * learner actually SEES the decode strategy in the 3D scene.
 */

/**
 * Speculative-decoding readout. Everything drawn here is a real frame value:
 * nothing is hardcoded.
 */
function SpeculativeReadout({
  nAccepted,
  draftPos,
  gamma,
}: {
  nAccepted: number;
  draftPos: number;
  gamma: number | undefined;
}) {
  const isContinuation = draftPos >= nAccepted;
  const label = isContinuation
    ? `spec: ${nAccepted}/${gamma ?? "?"} drafts accepted`
    : `spec: accepted draft ${draftPos + 1}/${nAccepted}`;

  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          fontFamily: "monospace",
          fontSize: "14px",
          fontWeight: 600,
          color: isContinuation ? "#ffd36e" : "#ff9f43",
          background: "rgba(0,0,0,0.7)",
          padding: "8px 12px",
          borderRadius: "4px",
          border: `1px solid ${isContinuation ? "#ffd36e" : "#ff9f43"}`,
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
          zIndex: 100,
        }}
      >
        {label}
      </div>
    </Html>
  );
}

/**
 * KV-cache window visual. Shows the real cache status: live window vs
 * everything seen, the trim boundary, the needle's position and whether it is
 * still re-attended to. All values come from real frame fields
 * (`cache_len`, `n_positions`, `cache_trimmed`) plus `meta`.
 */
function SlidingWindowBar({
  cacheLen,
  nPositions,
  windowSize,
  totalPositions,
  trimmed,
  sliding,
  needleSpan,
}: {
  cacheLen: number;
  nPositions: number;
  windowSize: number;
  totalPositions: number;
  trimmed: boolean;
  sliding: boolean;
  needleSpan: NeedleSpan | null;
}) {
  if (totalPositions <= 0) return null;

  const state = windowState(cacheLen, windowSize, trimmed);
  const windowFrac = windowFraction(cacheLen, nPositions, totalPositions);
  const attended = attendedPositions(cacheLen, nPositions) ?? cacheLen;

  // Needle marker: where the [MEMORY] fact sits inside the sequence, and
  // whether it is still inside the live window (keptFrom = oldest position the
  // cache still holds for this frame).
  const keptFrom = Math.max(0, totalPositions - attended);
  const needleEvicted = needleSpan != null && needleSpan.end <= keptFrom;
  const needleLeft = needleSpan ? (needleSpan.start / totalPositions) * 100 : 0;
  const needleWidth = needleSpan
    ? Math.max(((needleSpan.end - needleSpan.start) / totalPositions) * 100, 0.8)
    : 0;

  const labelColor =
    sliding && state === "trimming" ? "#ffd36e" : sliding && state === "full" ? "#ffb347" : "#57d0ff";
  const label =
    sliding && state === "trimming"
      ? `KV window: ${cacheLen} / ${windowSize} (trimming oldest)`
      : sliding && state === "full"
        ? `KV window: ${cacheLen} / ${windowSize} (full — trims next step)`
        : sliding
          ? `KV cache: ${cacheLen} / ${windowSize} window · ${totalPositions} positions`
          : `KV cache: ${attended} / ${totalPositions} positions`;

  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: "80px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
          zIndex: 100,
        }}
      >
        {/* Bar container */}
        <div
          style={{
            width: "400px",
            height: "16px",
            background: "#1a2030",
            borderRadius: "3px",
            position: "relative",
            overflow: "visible",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {/* Live window overlay — attended positions over everything seen */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: `${windowFrac * 100}%`,
              background:
                sliding && state !== "growing"
                  ? "linear-gradient(90deg, rgba(255,211,110,0.3), rgba(255,211,110,0.5))"
                  : "linear-gradient(90deg, rgba(87,208,255,0.3), rgba(87,208,255,0.5))",
              borderRadius: "2px",
            }}
          />
          {/* Trim boundary — only when the backend really trimmed this frame */}
          {sliding && state === "trimming" && (
            <div
              style={{
                position: "absolute",
                right: `${(1 - windowFrac) * 100}%`,
                top: "-2px",
                bottom: "-2px",
                width: "2px",
                background: "#ff6b6b",
              }}
            />
          )}
          {/* Needle marker across its token span */}
          {needleSpan && (
            <div
              title={
                needleEvicted
                  ? "needle left the KV window — no longer re-attended"
                  : "needle inside the KV window — still re-attended"
              }
              style={{
                position: "absolute",
                left: `${needleLeft}%`,
                width: `${needleWidth}%`,
                top: "-3px",
                bottom: "-3px",
                background: needleEvicted ? "rgba(255,107,107,0.85)" : "rgba(85,239,196,0.85)",
                borderRadius: "2px",
                boxShadow: "0 0 6px rgba(0,0,0,0.6)",
              }}
            />
          )}
        </div>
        {/* Label */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            color: labelColor,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
        {needleSpan && (
          <div
            style={{
              fontFamily: "monospace",
              fontSize: "10px",
              color: needleEvicted ? "#ff6b6b" : "#55efc4",
              whiteSpace: "nowrap",
              marginTop: "-2px",
            }}
          >
            {`needle @ ${needleSpan.start}–${needleSpan.end} · ${
              needleEvicted ? "evicted — not re-attended" : "in window — re-attended"
            }`}
          </div>
        )}
      </div>
    </Html>
  );
}

/**
 * Needle recall banner. `needle_report` only exists on the done frame — no
 * per-token attention field is emitted — so we show the recall verdict once
 * generation ends, as a fixed overlay that never depends on camera position.
 */
function NeedleRecallBanner({ needle, recalled }: { needle: string; recalled: boolean }) {
  const short = needle.length > 28 ? needle.slice(0, 25) + "…" : needle;
  return (
    <Html fullscreen style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          fontFamily: "monospace",
          fontSize: "13px",
          fontWeight: 600,
          color: recalled ? "#55efc4" : "#ff6b6b",
          background: "rgba(0,0,0,0.7)",
          padding: "8px 12px",
          borderRadius: "4px",
          border: `1px solid ${recalled ? "#55efc4" : "#ff6b6b"}`,
          textShadow: "0 0 4px rgba(0,0,0,0.8)",
          zIndex: 100,
        }}
      >
        {recalled ? `✓ needle recalled: "${short}"` : `✗ needle missed: "${short}"`}
      </div>
    </Html>
  );
}

/** Mounts every decode-mode overlay the current run deserves (issue #297). */
export default function DecodeModeOverlays() {
  const meta = useStore((s) => s.genMeta);
  const frames = useStore((s) => s.genFrames);
  const playIndex = useStore((s) => s.playIndex);
  const genDone = useStore((s) => s.genDone);

  const frame =
    playIndex >= 0 && playIndex < frames.length
      ? frames[playIndex]
      : frames.length
        ? frames[frames.length - 1]
        : null;

  // Does ANY frame in this run carry speculative-decoding annotations? Drives
  // whether the readout is mounted at all, so greedy runs pay nothing.
  const hasSpecData = useMemo(
    () => frames.some((f) => f.accepted_drafts === true),
    [frames],
  );

  // Speculative fields for the CURRENT frame (absent on greedy frames).
  const specNAccepted = frame?.n_accepted;
  const specDraftPos = frame?.draft_pos;
  const specGamma = meta?.decoding_params?.draft_gamma;

  // Sliding-window fields — cache_len is the real fed-cache length per frame.
  const isSlidingWindow = meta?.decoding === "sliding_window";
  const windowSize = meta?.decoding_params?.window_size ?? 512;
  const cacheLen = frame?.cache_len ?? 0;
  const nPositions = frame?.n_positions ?? 0;
  const trimmed = frame?.cache_trimmed === true;
  // Positions fed through this frame: the backend's net position count is
  // prompt_len + step (prefill consumes the prompt at step 0, every emitted
  // token adds exactly one position — including speculative batches).
  const totalPositions = (meta?.prompt_len ?? 0) + (frame?.step ?? 0);

  // Needle probe — the [MEMORY] fact's token span inside the prompt.
  const needleSpan = findNeedleSpan(meta?.prompt_tokens ?? [], meta?.decoding_params?.needle);
  // Needle recall — only on done frame, shown after generation finishes.
  const needleReport = genDone?.needle_report ?? null;

  return (
    <>
      {/* --- Speculative decoding readout (issue #297) --- */}
      {hasSpecData &&
        frame?.accepted_drafts === true &&
        specNAccepted != null &&
        specDraftPos != null && (
          <SpeculativeReadout
            nAccepted={specNAccepted}
            draftPos={specDraftPos}
            gamma={specGamma}
          />
        )}

      {/* --- KV cache window bar (issue #297): shown for sliding-window runs
             and for any run carrying a needle probe, so the needle's live
             re-attended window is visible in the 3D scene. --- */}
      {cacheLen > 0 && (isSlidingWindow || needleSpan) && (
        <SlidingWindowBar
          cacheLen={cacheLen}
          nPositions={nPositions}
          windowSize={windowSize}
          totalPositions={totalPositions}
          trimmed={trimmed}
          sliding={isSlidingWindow}
          needleSpan={needleSpan}
        />
      )}

      {/* --- Needle recall banner (issue #297) — post-generation only --- */}
      {needleReport && (
        <NeedleRecallBanner
          needle={needleReport.needle}
          recalled={needleReport.recalled}
        />
      )}
    </>
  );
}
