import assert from "node:assert/strict";
import test from "node:test";
import { wsGenerate, type GenOptions } from "../../lib/ws";

/**
 * Issue #297 - WebSocket generate request payload.
 * Tests the real production payload construction by mocking WebSocket.
 */

let capturedPayload: any = null;
let capturedUrl: string = '';

class MockWS {
  onopen: any = null;
  onmessage: any = null;
  onerror: any = null;
  onclose: any = null;
  constructor(url: string) {
    capturedUrl = url;
    setTimeout(() => this.onopen && this.onopen(), 0);
  }
  send(data: string) { capturedPayload = JSON.parse(data); }
}

test("wsGenerate sends correct speculative payload", async () => {
  (global as any).WebSocket = MockWS;
  capturedPayload = null;
  const opts: GenOptions = {
    decodingMode: "speculative",
    draftGamma: 3,
    windowSize: 512,
    needle: "test needle",
    temperature: 0.8,
    topK: 10,
  };
  wsGenerate("prompt", opts, { onFrame: () => {} });
  await new Promise(r => setTimeout(r, 10));
  assert.ok(capturedPayload, "payload captured");
  assert.equal(capturedPayload.decoding_mode, "speculative");
  assert.equal(capturedPayload.draft_gamma, 3);
  assert.equal(capturedPayload.window_size, 512);
  assert.equal(capturedPayload.needle, "test needle");
  assert.equal(capturedPayload.temperature, 0.8);
});

test("wsGenerate applies defaults", async () => {
  (global as any).WebSocket = MockWS;
  capturedPayload = null;
  wsGenerate("test", {}, { onFrame: () => {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(capturedPayload.decoding_mode, "greedy");
  assert.equal(capturedPayload.window_size, 512);
  assert.equal(capturedPayload.draft_gamma, 4);
});

test("wsGenerate sends sliding_window config", async () => {
  (global as any).WebSocket = MockWS;
  capturedPayload = null;
  wsGenerate("test", { decodingMode: "sliding_window", windowSize: 64 }, { onFrame: () => {} });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(capturedPayload.decoding_mode, "sliding_window");
  assert.equal(capturedPayload.window_size, 64);
});
