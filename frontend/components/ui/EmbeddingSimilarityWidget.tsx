"use client";

import React, { useRef, useState } from "react";
import { analyzeSimilarity } from "@/lib/api";
import {
  MAX_SIMILARITY_SENTENCES,
  mostSimilarPair,
  offDiagonalRange,
  parseSentences,
  sentenceCountError,
  shadeIntensity,
} from "@/lib/similarity";
import type { SimilarityResponse } from "@/lib/types";

const EXAMPLE = [
  "The cat sat on the mat.",
  "A kitten was resting on the rug.",
  "Stock markets fell sharply today.",
].join("\n");

const mono: React.CSSProperties = { fontFamily: "var(--mono)" };

/**
 * Prompt-level embedding similarity for encoder models (issue #298).
 *
 * Every number shown is a cosine similarity between real mean-pooled sentence
 * embeddings returned by POST /analyze/similarity — nothing is computed or
 * approximated client-side except the cell shading.
 */
export function EmbeddingSimilarityWidget() {
  const [text, setText] = useState(EXAMPLE);
  const [result, setResult] = useState<SimilarityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const sentences = parseSentences(text);
  const countError = sentenceCountError(sentences);

  async function compare() {
    if (countError) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await analyzeSimilarity(sentences);
      if (id === requestId.current) setResult(res);
    } catch (e) {
      if (id === requestId.current) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Similarity request failed");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  const range = result ? offDiagonalRange(result.matrix) : null;
  const best = result ? mostSimilarPair(result.matrix) : null;

  return (
    <div className="rp-section" style={{ borderBottom: "none" }} data-testid="embedding-similarity">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="rp-section-title">EMBEDDING SIMILARITY</span>
        <span style={{ ...mono, fontSize: "10px", color: "#94a3b8" }}>cosine · mean-pooled</span>
      </div>

      <label htmlFor="similarity-input" style={{ display: "block", fontSize: "10px", color: "#94a3b8", margin: "6px 0 4px" }}>
        One sentence per line (2–{MAX_SIMILARITY_SENTENCES})
      </label>
      <textarea
        id="similarity-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void compare();
        }}
        rows={Math.min(MAX_SIMILARITY_SENTENCES, Math.max(3, sentences.length + 1))}
        spellCheck={false}
        style={{
          ...mono,
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          fontSize: "11px",
          lineHeight: 1.5,
          color: "#e2e8f0",
          background: "#030305",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "4px",
          padding: "6px 8px",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
        <button
          type="button"
          onClick={() => void compare()}
          disabled={loading || !!countError}
          style={{
            ...mono,
            fontSize: "11px",
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: "4px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: loading || countError ? "transparent" : "#ffffff",
            color: loading || countError ? "#64748b" : "#030305",
            cursor: loading || countError ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Comparing…" : "Compare"}
        </button>
        <span role="status" style={{ fontSize: "10px", color: countError ? "#fbbf24" : "#64748b" }}>
          {countError ?? `${sentences.length} sentences · one forward pass each`}
        </span>
      </div>

      {error && (
        <div role="alert" style={{ marginTop: "8px", fontSize: "11px", color: "#f87171" }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: "10px" }}>
          <table style={{ ...mono, borderCollapse: "separate", borderSpacing: "2px", fontSize: "10px", width: "100%" }}>
            <caption style={{ textAlign: "left", fontSize: "10px", color: "#94a3b8", paddingBottom: "4px" }}>
              Cosine similarity, S<sub>i</sub> vs S<sub>j</sub>
            </caption>
            <thead>
              <tr>
                <th scope="col" />
                {result.sentences.map((_, j) => (
                  <th key={j} scope="col" style={{ color: "#64748b", fontWeight: 600 }}>
                    S{j + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.matrix.map((row, i) => (
                <tr key={i}>
                  <th scope="row" style={{ color: "#64748b", fontWeight: 600, textAlign: "left" }}>
                    S{i + 1}
                  </th>
                  {row.map((v, j) => {
                    const diag = i === j;
                    const t = diag ? 0 : shadeIntensity(v, range);
                    return (
                      <td
                        key={j}
                        title={`S${i + 1} · S${j + 1} = ${v.toFixed(4)}`}
                        style={{
                          textAlign: "center",
                          padding: "4px 0",
                          borderRadius: "2px",
                          color: diag ? "#475569" : t > 0.55 ? "#030305" : "#e2e8f0",
                          background: diag ? "transparent" : `rgba(255,255,255,${(0.06 + 0.84 * t).toFixed(3)})`,
                        }}
                      >
                        {v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <ol style={{ margin: "8px 0 0", paddingLeft: "22px", fontSize: "10px", color: "#cbd5e1", lineHeight: 1.6 }}>
            {result.sentences.map((s, i) => (
              <li key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.text}>
                <span style={{ color: "#64748b", ...mono }}>S{i + 1}</span> {s.text}{" "}
                <span style={{ color: "#64748b", ...mono }}>({s.num_tokens} tok)</span>
              </li>
            ))}
          </ol>

          {best && (
            <div style={{ marginTop: "6px", fontSize: "10px", color: "#e2e8f0" }}>
              Most similar: S{best.i + 1} &amp; S{best.j + 1} ({best.value.toFixed(3)})
            </div>
          )}

          <div style={{ marginTop: "6px", fontSize: "9.5px", color: "#64748b", lineHeight: 1.5 }}>
            {result.model} · {result.embedding_dim}-d · {result.pooling_note}.
            {range && (
              <>
                {" "}
                Shading is relative to the off-diagonal range ({range.min.toFixed(2)}–{range.max.toFixed(2)}); cell
                values are exact.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
