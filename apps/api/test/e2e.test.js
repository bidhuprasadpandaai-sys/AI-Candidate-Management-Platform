// End-to-end API test: starts the real server (in-memory store, no MongoDB) and a fake
// Ollama server, then drives the full recruiter flow over HTTP.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const apiDir = fileURLToPath(new URL("..", import.meta.url));
let server;
let fakeOllama;
let base;
let cookie = "";
const llmRequests = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function call(method, path, body, { auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth && cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { res, data };
}

before(async () => {
  const llmPort = await freePort();
  fakeOllama = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      llmRequests.push({ url: req.url, body: JSON.parse(raw || "{}") });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "Fake model says hello" } }] }));
    });
  });
  await new Promise((resolve) => fakeOllama.listen(llmPort, "127.0.0.1", resolve));

  const port = await freePort();
  base = `http://127.0.0.1:${port}/api`;
  server = spawn(process.execPath, ["src/index.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      PORT: String(port),
      MONGODB_URI: "",
      JWT_SECRET: "e2e-test-secret-e2e-test-secret-123456",
      NODE_ENV: "test",
      CLIENT_URL: "http://localhost:4410",
      LLM_PROVIDER: "ollama",
      OLLAMA_HOST: `http://127.0.0.1:${llmPort}`,
      OLLAMA_MODEL: "fake-model",
      OLLAMA_API_KEY: ""
    },
    stdio: "ignore"
  });

  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("API did not start");
});

after(async () => {
  server?.kill();
  await new Promise((resolve) => (fakeOllama ? fakeOllama.close(resolve) : resolve()));
});

test("public endpoints work and security headers are set", async () => {
  const { res, data } = await call("GET", "/health", null, { auth: false });
  assert.equal(res.status, 200);
  assert.equal(data.status, "ok");
  assert.equal(data.usingDatabase, false);
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await call("GET", "/modules", null, { auth: false })).res.status, 200);
});

test("protected routes reject anonymous callers", async () => {
  for (const [method, path] of [
    ["GET", "/candidates"],
    ["GET", "/dashboard"],
    ["POST", "/chat"],
    ["DELETE", "/candidates/x"],
    ["POST", "/seed"]
  ]) {
    const { res } = await call(method, path, method === "GET" ? null : {}, { auth: false });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("sign-up validates input and rejects weak passwords", async () => {
  const weak = await call("POST", "/auth/signup", { name: "E2E", email: "e2e@example.com", password: "weak" }, { auth: false });
  assert.equal(weak.res.status, 400);
  const badEmail = await call("POST", "/auth/signup", { name: "E2E", email: "nope", password: "Strong123" }, { auth: false });
  assert.equal(badEmail.res.status, 400);
});

test("sign-up, duplicate sign-up, wrong password and sign-in", async () => {
  const user = { name: "E2E User", email: "e2e@example.com", password: "Strong123", role: "Recruiter" };
  assert.equal((await call("POST", "/auth/signup", user, { auth: false })).res.status, 201);
  assert.equal((await call("POST", "/auth/signup", user, { auth: false })).res.status, 409);
  assert.equal((await call("POST", "/auth/signin", { email: user.email, password: "Wrong1234" }, { auth: false })).res.status, 401);

  const { res, data } = await call("POST", "/auth/signin", { email: user.email, password: user.password }, { auth: false });
  assert.equal(res.status, 200);
  assert.equal(data.user.email, user.email);
  assert.equal(data.user.passwordHash, undefined);
  const setCookie = res.headers.get("set-cookie");
  assert.match(setCookie, /auth_token=/);
  assert.match(setCookie, /HttpOnly/i);
  cookie = setCookie.split(";")[0];
});

test("signed-in user sees their profile", async () => {
  const { res, data } = await call("GET", "/auth/me");
  assert.equal(res.status, 200);
  assert.equal(data.user.email, "e2e@example.com");
});

test("dashboard and candidate list come from the demo data", async () => {
  const dash = await call("GET", "/dashboard");
  assert.equal(dash.res.status, 200);
  assert.ok(dash.data.metrics.totalCandidates >= 1);
  assert.equal(dash.data.usingMemoryStore, true);

  const list = await call("GET", "/candidates?limit=3&page=1");
  assert.equal(list.res.status, 200);
  assert.equal(list.data.candidates.length, 3);
  assert.ok(list.data.total >= 3);

  const filtered = await call("GET", "/candidates?status=hired");
  assert.ok(filtered.data.candidates.every((c) => c.status === "hired"));
});

test("candidate create, update and delete", async () => {
  const created = await call("POST", "/candidates", {
    name: "E2E Candidate",
    email: "candidate-e2e@example.com",
    role: "QA Engineer",
    status: "screening",
    score: 70,
    skills: ["testing"]
  });
  assert.equal(created.res.status, 201);
  const id = created.data.id;
  assert.ok(id);

  const updated = await call("PUT", `/candidates/${id}`, { status: "interview" });
  assert.equal(updated.res.status, 200);
  assert.equal(updated.data.status, "interview");

  const search = await call("GET", "/candidates?search=E2E%20Candidate");
  assert.equal(search.data.candidates.length, 1);

  assert.equal((await call("DELETE", `/candidates/${id}`)).res.status, 200);
  assert.equal((await call("PUT", `/candidates/${id}`, { status: "offer" })).res.status, 404);
});

test("candidate input is validated and whitelisted (BUG-002)", async () => {
  const empty = await call("POST", "/candidates", {});
  assert.equal(empty.res.status, 400);
  assert.ok(empty.data.errors.length >= 3);
  assert.equal((await call("POST", "/candidates", { name: "A", email: "bad", role: "R" })).res.status, 400);
  assert.equal((await call("POST", "/candidates", { name: "A", email: "a@example.com", role: "R", status: "boss" })).res.status, 400);
  assert.equal((await call("POST", "/candidates", { name: "A", email: "a@example.com", role: "R", score: 500 })).res.status, 400);
  assert.equal((await call("POST", "/candidates", { name: { $ne: "" }, email: "a@example.com", role: "R" })).res.status, 400);

  const ok = await call("POST", "/candidates", { name: "Valid One", email: "Valid.One@Example.com", role: "Dev", isAdmin: true, id: "hijack" });
  assert.equal(ok.res.status, 201);
  assert.equal(ok.data.email, "valid.one@example.com");
  assert.equal(ok.data.isAdmin, undefined);
  assert.notEqual(ok.data.id, "hijack");

  const dup = await call("POST", "/candidates", { name: "Valid Two", email: "valid.one@example.com", role: "Dev" });
  assert.equal(dup.res.status, 409);

  assert.equal((await call("PUT", `/candidates/${ok.data.id}`, { status: "boss" })).res.status, 400);
  const upd = await call("PUT", `/candidates/${ok.data.id}`, { score: 55, isAdmin: true, id: "x" });
  assert.equal(upd.res.status, 200);
  assert.equal(upd.data.score, 55);
  assert.equal(upd.data.isAdmin, undefined);
  assert.equal(upd.data.id, ok.data.id);
  await call("DELETE", `/candidates/${ok.data.id}`);
});

test("assistant: free-form question goes to the model without contact details", async () => {
  llmRequests.length = 0;
  const { res, data } = await call("POST", "/chat", { message: "Summarize the pipeline in one line" });
  assert.equal(res.status, 200);
  assert.equal(data.source, "llm");
  assert.equal(data.reply, "Fake model says hello");
  assert.equal(data.actionExecuted, false);
  assert.equal(llmRequests.length, 1);
  assert.equal(llmRequests[0].url, "/v1/chat/completions");
  assert.equal(llmRequests[0].body.model, "fake-model");
  assert.equal(/@example\.com|@/.test(JSON.stringify(llmRequests[0].body.messages)), false, "email leaked to the model");
});

test("assistant: data-changing commands stay rule-based and never call the model", async () => {
  const list = await call("GET", "/candidates");
  const target = list.data.candidates[0];
  llmRequests.length = 0;
  const { res, data } = await call("POST", "/chat", { message: `Move ${target.name} to offer` });
  assert.equal(res.status, 200);
  assert.equal(data.source, "rules");
  assert.equal(data.actionExecuted, true);
  assert.equal(llmRequests.length, 0);
  const after = await call("GET", "/candidates");
  assert.equal(after.data.candidates.find((c) => c.id === target.id).status, "offer");
});

test("logout clears the cookie", async () => {
  const { res } = await call("POST", "/auth/logout");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("set-cookie") || "", /auth_token=;/);
});

test("rate limit: repeated bad sign-ins are throttled", async () => {
  let last;
  for (let i = 0; i < 25; i += 1) {
    last = (await call("POST", "/auth/signin", { email: "x@example.com", password: "Wrong1234" }, { auth: false })).res.status;
  }
  assert.equal(last, 429);
});
