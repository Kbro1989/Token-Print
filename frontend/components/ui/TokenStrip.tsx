"use client";

import { useStore } from "@/lib/store";
import { specTokenLabel } from "@/lib/specDecoding";
import { tokenClass } from "@/lib/tokenDisplay";
import { findNeedleSpan } from "@/lib/genReadouts";

function disp(t: string): string {
  const s = t.replace(/\n/g, "⏎");
  return s.length === 0 ? "␣" : s;
}

export default function TokenStrip() {
  const meta = useStore((s) => s.genMeta);
  const frames = useStore((s) => s.genFrames);
  const status = useStore((s) => s.genStatus);
  if (!meta) return null;

  const gen = frames.filter((f) => !f.eos);
  // Show only the tail of the (often long chat-template) prompt so the
  // generated tokens stay prominent.
  const TAIL = 8;
  const promptTail = meta.prompt_tokens.slice(-TAIL);
  const truncated = meta.prompt_tokens.length > TAIL;

  // Issue #297 — needle probe: highlight the memory fact's own tokens. They sit
  // at the FRONT of the prompt, so when the tail hides them we surface the
  // needle span explicitly instead of silently dropping it from the strip.
  const needleSpan = findNeedleSpan(meta.prompt_tokens, meta.decoding_params?.needle);
  const tailOffset = meta.prompt_tokens.length - promptTail.length;
  const needleInTail = needleSpan != null && needleSpan.end > tailOffset;
  const needleHead = needleSpan != null && !needleInTail
    ? meta.prompt_tokens.slice(needleSpan.start, needleSpan.end)
    : [];
  const isNeedle = (globalIndex: number) =>
    needleSpan != null && globalIndex >= needleSpan.start && globalIndex < needleSpan.end;

  return (
    <div className="token-strip">
      <span className="ts-label">tokens</span>
      {needleHead.length > 0 && (
        <>
          {needleHead.map((t, i) => (
            <span
              key={`n${i}`}
              className="tok prompt needle"
              title="needle — the [MEMORY] fact under test"
            >
              {disp(t)}
            </span>
          ))}
          <span className="tok prompt" title="prompt continues">…</span>
        </>
      )}
      {!needleHead.length && truncated && <span className="tok prompt">…</span>}
      {promptTail.map((t, i) => (
        <span
          key={"p" + i}
          className={isNeedle(tailOffset + i) ? "tok prompt needle" : "tok prompt"}
          title={isNeedle(tailOffset + i) ? "needle — the [MEMORY] fact under test" : undefined}
        >
          {disp(t)}
        </span>
      ))}
      {gen.map((f, i) => (
        <span
          key={"g" + i}
          className={tokenClass(f, i === gen.length - 1)}
          title={specTokenLabel(f) || undefined}
        >
          {disp(f.chosen.text)}
        </span>
      ))}
      {status === "streaming" && <span className="tok cursor">▌</span>}
      {gen.some((f) => f.accepted_drafts === true) && (
        <span className="ts-legend" style={{ marginLeft: "8px", fontSize: "0.7em", opacity: 0.6 }}>
          (orange: accepted draft, gold: target continuation; first token is from prefill)
        </span>
      )}
    </div>
  );
}
