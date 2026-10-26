import assert from "node:assert/strict";
import test from "node:test";
import { detectArch, getFormula, roleToOpKey, contextOp, type OpKey, type ArchFamily } from "../../lib/formulas";

test("detectArch accurately identifies LLaMA and Qwen model families", () => {
  assert.equal(detectArch("qwen2"), "llama");
  assert.equal(detectArch("Qwen2.5-0.5B-Instruct"), "llama");
  assert.equal(detectArch("llama-3.2"), "llama");
  assert.equal(detectArch("mistral"), "llama");
  assert.equal(detectArch("phi3"), "llama");
  assert.equal(detectArch("gpt2"), "gpt2");
  assert.equal(detectArch("gptj"), "gpt2");
  assert.equal(detectArch(null), "llama");
  assert.equal(detectArch(""), "llama");
});

test("detectArch accurately identifies Gemma architecture variants", () => {
  assert.equal(detectArch("gemma"), "gemma");
  assert.equal(detectArch("gemma2"), "gemma");
  assert.equal(detectArch("gemma3"), "gemma");
  assert.equal(detectArch("google/gemma-2-2b-it"), "gemma");
  assert.equal(detectArch("gemma-7b"), "gemma");
  assert.equal(detectArch("Gemma-2-9B-Instruct"), "gemma");
});

test("getFormula returns Gemma-specific mathematical formulations", () => {
  // 1. Scaled embeddings
  const emb = getFormula("gemma", "embedding");
  assert.equal(emb.title, "Token Embedding (Scaled)");
  assert.ok(emb.latex[0].includes(String.raw`\sqrt{d_{\text{model}}}`));

  // 2. Unit-offset RMSNorm
  const norm = getFormula("gemma", "norm");
  assert.equal(norm.title, "RMS Normalization (Unit Offset)");
  assert.ok(norm.latex[0].includes(String.raw`1 + \gamma`));

  // 3. GeGLU MLP
  const mlp = getFormula("gemma", "mlp");
  assert.equal(mlp.title, "GeGLU MLP");
  assert.ok(mlp.latex[0].includes(String.raw`\mathrm{GELU}`));
  assert.ok(!mlp.latex[0].includes(String.raw`\mathrm{SiLU}`));

  // 4. Gate projection uses GELU
  const gate = getFormula("gemma", "mlp.gate");
  assert.equal(gate.title, "Gate Projection (GELU)");
  assert.ok(gate.latex[0].includes(String.raw`\mathrm{GELU}`));

  // 5. Attention with logit soft-capping
  const attn = getFormula("gemma", "attention");
  assert.ok(attn.title.includes("Soft-Capping"));
  assert.ok(attn.latex[0].includes(String.raw`\tanh`));
  assert.ok(attn.latex[0].includes(String.raw`\mathrm{cap}`));

  // 6. Tied weights unembedding
  const output = getFormula("gemma", "output");
  assert.ok(output.title.includes("Tied Weights"));
});

test("getFormula distinguishes LLaMA, GPT2, and Gemma architectures", () => {
  const llamaNorm = getFormula("llama", "norm");
  const gemmaNorm = getFormula("gemma", "norm");
  const gpt2Norm = getFormula("gpt2", "norm");

  // Norms differ across all three
  assert.ok(!llamaNorm.latex[0].includes(String.raw`1 + \gamma`));
  assert.ok(gemmaNorm.latex[0].includes(String.raw`1 + \gamma`));
  assert.ok(gpt2Norm.latex[0].includes(String.raw`x_{\text{ln}}`));

  // MLPs differ: LLaMA uses SiLU/SwiGLU, Gemma uses GELU/GeGLU, GPT-2 uses GELU FC
  const llamaMlp = getFormula("llama", "mlp");
  const gemmaMlp = getFormula("gemma", "mlp");
  assert.ok(llamaMlp.latex[0].includes(String.raw`\mathrm{SiLU}`));
  assert.ok(gemmaMlp.latex[0].includes(String.raw`\mathrm{GELU}`));

  // Embeddings differ: Gemma scales by sqrt(d_model), LLaMA does not
  const llamaEmb = getFormula("llama", "embedding");
  const gemmaEmb = getFormula("gemma", "embedding");
  assert.ok(!llamaEmb.latex[0].includes(String.raw`\sqrt{d_{\text{model}}}`));
  assert.ok(gemmaEmb.latex[0].includes(String.raw`\sqrt{d_{\text{model}}}`));
});

test("all OpKeys produce non-empty formulas for every supported family", () => {
  const families: ArchFamily[] = ["llama", "gpt2", "gemma"];
  const opKeys: OpKey[] = [
    "embedding",
    "position",
    "norm",
    "attention",
    "attn.q",
    "attn.k",
    "attn.v",
    "attn.o",
    "mlp",
    "mlp.gate",
    "mlp.up",
    "mlp.down",
    "output",
  ];

  for (const fam of families) {
    for (const op of opKeys) {
      const formula = getFormula(fam, op);
      assert.ok(formula.title.length > 0, `Expected title for ${fam}/${op}`);
      // Only gpt2 mlp.gate is empty by design
      if (fam === "gpt2" && op === "mlp.gate") continue;
      assert.ok(formula.latex.length > 0, `Expected latex lines for ${fam}/${op}`);
    }
  }
});

test("roleToOpKey and contextOp map correctly", () => {
  assert.equal(roleToOpKey("embedding"), "embedding");
  assert.equal(roleToOpKey("attn.q"), "attn.q");
  assert.equal(roleToOpKey("mlp.gate"), "mlp.gate");
  assert.equal(roleToOpKey("unknown"), null);

  assert.equal(contextOp("attn.q"), "attention");
  assert.equal(contextOp("mlp.down"), "mlp");
  assert.equal(contextOp("norm"), "norm");
});
