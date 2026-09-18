import assert from "node:assert/strict";
import test from "node:test";
import { detectArch } from "../../lib/formulas";

test("detectArch accurately identifies LLaMA and Qwen model families", () => {
  assert.equal(detectArch("qwen2"), "llama");
  assert.equal(detectArch("Qwen2.5-0.5B-Instruct"), "llama");
  assert.equal(detectArch("llama-3.2"), "llama");
  assert.equal(detectArch("gpt2"), "gpt2");
  assert.equal(detectArch(null), "llama");
});
