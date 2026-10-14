import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, generateLlmReply, getLlmConfig } from "../src/services/llm.js";

const quiet = { warn() {} };
const env = {
  LLM_PROVIDER: "ollama",
  OLLAMA_HOST: "http://ollama.example.test/",
  OLLAMA_MODEL: "demo-model"
};
const candidates = [
  {
    name: "Ada Lovelace",
    role: "Engineer",
    status: "Interview",
    score: 90,
    experienceYears: 7,
    skills: ["math", "code"],
    email: "ada@example.com",
    phone: "555-0100",
    notes: [{ text: "secret note" }]
  }
];
const okResponse = (content) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] })
});

test("config: disabled for rules provider or missing host/model", () => {
  assert.equal(getLlmConfig({}).enabled, false);
  assert.equal(getLlmConfig({ LLM_PROVIDER: "rules", OLLAMA_HOST: "x", OLLAMA_MODEL: "m" }).enabled, false);
  assert.equal(getLlmConfig({ LLM_PROVIDER: "ollama", OLLAMA_MODEL: "m" }).enabled, false);
  assert.equal(getLlmConfig(env).enabled, true);
});

test("config: strips trailing slash and /v1 from host; LLM_MODEL overrides", () => {
  assert.equal(getLlmConfig({ ...env, OLLAMA_HOST: "http://h.test/v1/" }).host, "http://h.test");
  assert.equal(getLlmConfig({ ...env, LLM_MODEL: "other" }).model, "other");
});

test("prompt never includes contact details or notes", () => {
  const text = JSON.stringify(buildMessages("who is best?", candidates));
  assert.ok(text.includes("Ada Lovelace"));
  for (const leaked of ["ada@example.com", "555-0100", "secret note"]) {
    assert.equal(text.includes(leaked), false, `${leaked} leaked into prompt`);
  }
});

test("returns the model reply and calls /v1/chat/completions with bearer key", async () => {
  let call;
  const result = await generateLlmReply({
    message: "hi",
    candidates,
    env: { ...env, OLLAMA_API_KEY: "test-key" },
    logger: quiet,
    fetchImpl: async (url, init) => {
      call = { url, init };
      return okResponse("  Hello there  ");
    }
  });
  assert.deepEqual(result, { reply: "Hello there", source: "llm" });
  assert.equal(call.url, "http://ollama.example.test/v1/chat/completions");
  assert.equal(call.init.headers.Authorization, "Bearer test-key");
  assert.equal(JSON.parse(call.init.body).model, "demo-model");
  assert.equal(JSON.parse(call.init.body).stream, false);
});

test("returns null when disabled without calling fetch", async () => {
  let called = false;
  const result = await generateLlmReply({
    message: "hi",
    candidates,
    env: { LLM_PROVIDER: "rules" },
    fetchImpl: async () => {
      called = true;
    }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("falls back (null) on HTTP errors, network errors and empty replies", async () => {
  const run = (fetchImpl) => generateLlmReply({ message: "hi", candidates, env, logger: quiet, fetchImpl });
  assert.equal(await run(async () => ({ ok: false, status: 502 })), null);
  assert.equal(await run(async () => { throw new Error("boom"); }), null);
  assert.equal(await run(async () => okResponse("   ")), null);
  assert.equal(await run(async () => ({ ok: true, status: 200, json: async () => ({}) })), null);
});

test("errors are logged without message content or keys", async () => {
  const logs = [];
  await generateLlmReply({
    message: "private question",
    candidates,
    env: { ...env, OLLAMA_API_KEY: "test-key" },
    logger: { warn: (line) => logs.push(line) },
    fetchImpl: async () => { throw new Error("private question test-key"); }
  });
  assert.equal(logs.length, 1);
  assert.equal(/private question|test-key/.test(logs[0]), false);
});
