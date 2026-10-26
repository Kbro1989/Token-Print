import assert from "node:assert/strict";
import test from "node:test";
import { activeLayerOf, layerAnchors, anchorToLayerIndex } from "../../lib/playback";
import type { OpCatalogEntry } from "../../lib/types";

test("activeLayerOf maps catalog entry ops to layer indices", () => {
  const embedOp: any = {
    op_key: "embedding",
    name: "model.embed_tokens",
    shape: [151936, 896],
    layer: null,
  };
  const layerOp: any = {
    op_key: "attention",
    name: "model.layers.5.self_attn",
    shape: [896, 896],
    layer: 5,
  };
  const outputOp: any = {
    op_key: "output",
    name: "lm_head",
    shape: [896, 151936],
    layer: null,
  };

  assert.equal(activeLayerOf(embedOp, 24), -1);
  assert.equal(activeLayerOf(layerOp, 24), 5);
  assert.equal(activeLayerOf(outputOp, 24), 24);
  assert.equal(activeLayerOf(undefined, 24), null);
});

test("layerAnchors identifies execution op indices starting each active layer", () => {
  const catalog: any[] = [
    { op_key: "embedding", name: "embed", shape: [100, 10], layer: null },
    { op_key: "attention", name: "l0", shape: [10, 10], layer: 0 },
    { op_key: "mlp", name: "l0_mlp", shape: [10, 10], layer: 0 },
    { op_key: "attention", name: "l1", shape: [10, 10], layer: 1 },
    { op_key: "output", name: "out", shape: [10, 100], layer: null },
  ];

  const anchors = layerAnchors(catalog, 2);
  assert.deepEqual(anchors, [0, 1, 3, 4]);
});

test("anchorToLayerIndex maps anchor positions to transformer layer indices", () => {
  const catalog: any[] = [
    { op_key: "embedding", name: "embed", shape: [100, 10], layer: null },
    { op_key: "attention", name: "l0", shape: [10, 10], layer: 0 },
    { op_key: "mlp", name: "l0_mlp", shape: [10, 10], layer: 0 },
    { op_key: "attention", name: "l1", shape: [10, 10], layer: 1 },
    { op_key: "output", name: "out", shape: [10, 100], layer: null },
  ];
  const anchors = layerAnchors(catalog, 2);
  assert.equal(anchorToLayerIndex(catalog, anchors, 0, 2), -1);
  assert.equal(anchorToLayerIndex(catalog, anchors, 1, 2), 0);
  assert.equal(anchorToLayerIndex(catalog, anchors, 2, 2), 1);
  assert.equal(anchorToLayerIndex(catalog, anchors, 3, 2), 2);
  assert.equal(anchorToLayerIndex(catalog, anchors, -1, 2), -1);
  assert.equal(anchorToLayerIndex(catalog, anchors, 99, 2), -1);
});
