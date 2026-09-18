import assert from "node:assert/strict";
import test from "node:test";
import { fmtCount, fmtBytes, fmtShape, middleTruncate } from "../../lib/format";

test("fmtCount formats numbers into compact strings", () => {
  assert.equal(fmtCount(null), "—");
  assert.equal(fmtCount(151936), "151.9K");
  assert.equal(fmtCount(494032768), "494.03M");
  assert.equal(fmtCount(27000000000), "27.00B");
});

test("fmtBytes formats byte counts correctly", () => {
  assert.equal(fmtBytes(null), "—");
  assert.equal(fmtBytes(512), "512 B");
  assert.equal(fmtBytes(2048), "2.0 KB");
  assert.equal(fmtBytes(10485760), "10.0 MB");
  assert.equal(fmtBytes(5368709120), "5.00 GB");
});

test("fmtShape formats tensor shapes", () => {
  assert.equal(fmtShape([]), "scalar");
  assert.equal(fmtShape([24, 896]), "24 × 896");
});

test("middleTruncate truncates long strings with ellipsis", () => {
  assert.equal(middleTruncate("short_name"), "short_name");
  const longName = "model.layers.14.self_attn.q_proj.weight_matrix_with_extra_suffix";
  const truncated = middleTruncate(longName, 30);
  assert.ok(truncated.includes("…"));
  assert.ok(truncated.length <= 30);
});
