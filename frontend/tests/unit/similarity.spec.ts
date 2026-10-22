import { expect, test } from "@playwright/test";
import {
  MAX_SIMILARITY_SENTENCES,
  mostSimilarPair,
  offDiagonalRange,
  parseSentences,
  sentenceCountError,
  shadeIntensity,
} from "../../lib/similarity";

test.describe("embedding similarity helpers (issue #298)", () => {
  test("parseSentences splits lines, trims, and drops blanks", () => {
    expect(parseSentences("  a cat \n\n\tb dog\r\n   \nc")).toEqual(["a cat", "b dog", "c"]);
    expect(parseSentences("")).toEqual([]);
  });

  test("sentenceCountError enforces 2..MAX sentences", () => {
    expect(sentenceCountError(["one"])).toMatch(/at least 2/);
    expect(sentenceCountError(["one", "two"])).toBeNull();
    expect(sentenceCountError(Array(MAX_SIMILARITY_SENTENCES).fill("x"))).toBeNull();
    expect(sentenceCountError(Array(MAX_SIMILARITY_SENTENCES + 1).fill("x"))).toMatch(/At most 8/);
  });

  test("MAX_SIMILARITY_SENTENCES matches the backend schema limit", () => {
    expect(MAX_SIMILARITY_SENTENCES).toBe(8);
  });

  const M = [
    [1, 0.9, 0.4],
    [0.9, 1, 0.6],
    [0.4, 0.6, 1],
  ];

  test("offDiagonalRange ignores the diagonal", () => {
    expect(offDiagonalRange(M)).toEqual({ min: 0.4, max: 0.9 });
    expect(offDiagonalRange([[1]])).toBeNull();
  });

  test("shadeIntensity maps the off-diagonal range onto [0, 1] and clamps", () => {
    const r = { min: 0.4, max: 0.9 };
    expect(shadeIntensity(0.4, r)).toBe(0);
    expect(shadeIntensity(0.9, r)).toBe(1);
    expect(shadeIntensity(0.65, r)).toBeCloseTo(0.5, 9);
    expect(shadeIntensity(1.0, r)).toBe(1);
    expect(shadeIntensity(0.1, r)).toBe(0);
    expect(shadeIntensity(0.7, { min: 0.7, max: 0.7 })).toBe(1); // flat range: no divide-by-zero
    expect(shadeIntensity(0.7, null)).toBe(1);
  });

  test("mostSimilarPair finds the highest off-diagonal pair", () => {
    expect(mostSimilarPair(M)).toEqual({ i: 0, j: 1, value: 0.9 });
    expect(mostSimilarPair([[1]])).toBeNull();
  });
});

test.describe("review follow-ups (PR #393)", () => {
  test("backoffDelayMs doubles from 1s and caps at 15s", async () => {
    const { backoffDelayMs } = await import("../../lib/backoff");
    expect([0, 1, 2, 3, 4, 5, 50].map((n) => backoffDelayMs(n))).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
    expect(backoffDelayMs(-3)).toBe(1000);
  });

  test("analyzeSimilarity times out when the backend never answers", async () => {
    const { analyzeSimilarity } = await import("../../lib/api");
    const realFetch = globalThis.fetch;
    let sawSignal = false;
    // A fetch that never resolves on its own, only rejects when aborted.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        sawSignal = !!init?.signal;
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    try {
      await expect(analyzeSimilarity(["a cat", "a dog"], 30)).rejects.toThrow(/timed out/);
      expect(sawSignal).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("analyzeSimilarity surfaces the backend's error detail", async () => {
    const { analyzeSimilarity } = await import("../../lib/api");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "needs an encoder model" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(analyzeSimilarity(["a cat", "a dog"], 5000)).rejects.toThrow("needs an encoder model");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
