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
