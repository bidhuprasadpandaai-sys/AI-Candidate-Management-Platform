import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { sendEmail } from "../src/utils/email.js";

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
  mock.restoreAll();
});

function captureLogs() {
  const lines = [];
  mock.method(console, "log", (...args) => lines.push(args.join(" ")));
  return lines;
}

const body = 'Click <a href="http://app/resetpassword?token=SECRET123">here</a>';

test("by default logs only masked recipient and subject, never the body or token", async () => {
  delete process.env.EMAIL_DEBUG_LOG;
  const lines = captureLogs();
  assert.equal(await sendEmail("ada@example.com", "Password Reset", body), true);
  const out = lines.join("\n");
  assert.ok(out.includes("a***@example.com"));
  assert.ok(out.includes("Password Reset"));
  assert.equal(out.includes("ada@example.com"), false);
  assert.equal(out.includes("SECRET123"), false);
});

test("EMAIL_DEBUG_LOG=true prints the full message outside production", async () => {
  process.env.EMAIL_DEBUG_LOG = "true";
  process.env.NODE_ENV = "development";
  const out = (await (async () => { const l = captureLogs(); await sendEmail("ada@example.com", "S", body); return l; })()).join("\n");
  assert.ok(out.includes("SECRET123"));
});

test("EMAIL_DEBUG_LOG is ignored in production", async () => {
  process.env.EMAIL_DEBUG_LOG = "true";
  process.env.NODE_ENV = "production";
  const l = captureLogs();
  await sendEmail("ada@example.com", "S", body);
  assert.equal(l.join("\n").includes("SECRET123"), false);
});

// ── SMTP provider ─────────────────────────────────────────────────────────────
import { fakeSmtpServer } from "./helpers/fakeSmtp.js";
import { assertEmailConfig, getEmailConfig } from "../src/utils/email.js";

test("config: console by default; smtp needs host and from; user and pass together", () => {
  assert.equal(getEmailConfig({}).provider, "console");
  assert.doesNotThrow(() => assertEmailConfig({}));
  assert.throws(() => assertEmailConfig({ EMAIL_PROVIDER: "carrier-pigeon" }), /EMAIL_PROVIDER/);
  assert.throws(() => assertEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "h" }), /SMTP_HOST and EMAIL_FROM/);
  assert.throws(() => assertEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "h", EMAIL_FROM: "a@b.co", SMTP_USER: "u" }), /together/);
  assert.doesNotThrow(() => assertEmailConfig({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "h", EMAIL_FROM: "a@b.co" }));
  assert.equal(getEmailConfig({ SMTP_PORT: "465" }).secure, true);
  assert.equal(getEmailConfig({ SMTP_PORT: "587" }).secure, false);
});

test("smtp: delivers html and a plain-text part through a real SMTP connection", async () => {
  const { server, received, port } = await fakeSmtpServer();
  try {
    const env = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), EMAIL_FROM: "TalentOS <no-reply@example.com>" };
    mock.method(console, "log", () => {});
    const ok = await sendEmail("ada@example.com", "Password Reset", body, { env });
    assert.equal(ok, true);
    assert.ok(received.commands.some((c) => /^MAIL FROM:<no-reply@example\.com>/i.test(c)));
    assert.ok(received.commands.some((c) => /^RCPT TO:<ada@example\.com>/i.test(c)));
    assert.ok(received.data.includes("Subject: Password Reset"));
    assert.ok(received.data.includes("SECRET123"), "reset link is in the message sent to the recipient");
    assert.ok(/Content-Type: text\/plain/i.test(received.data) && /Content-Type: text\/html/i.test(received.data));
  } finally {
    server.close();
  }
});

test("smtp: failures return false, never throw, and logs hold no secrets or recipient", async () => {
  const lines = [];
  mock.method(console, "warn", (...args) => lines.push(args.join(" ")));
  const env = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "1", EMAIL_FROM: "a@b.co", SMTP_USER: "user", SMTP_PASS: "pa55word-secret" };
  const ok = await sendEmail("ada@example.com", "S", body, { env });
  assert.equal(ok, false);
  const out = lines.join("\n");
  assert.equal(/pa55word-secret|SECRET123|ada@example\.com/.test(out), false);
  assert.ok(out.includes("a***@example.com"));
});

test("rejects invalid recipients and strips newlines from the subject (header injection)", async () => {
  let sent;
  const transport = { sendMail: async (message) => { sent = message; } };
  const env = { EMAIL_PROVIDER: "smtp", SMTP_HOST: "h", EMAIL_FROM: "a@b.co" };
  mock.method(console, "log", () => {});
  mock.method(console, "warn", () => {});
  assert.equal(await sendEmail("bad address", "S", body, { env, transport }), false);
  assert.equal(await sendEmail("a@example.com\r\nBcc: evil@example.com", "S", body, { env, transport }), false);
  assert.equal(sent, undefined);
  assert.equal(await sendEmail("ada@example.com", "Hi\r\nBcc: evil@example.com", body, { env, transport }), true);
  assert.equal(sent.subject.includes("\n"), false);
});

// ── Brevo API provider ────────────────────────────────────────────────────────
import http from "node:http";
import { parseFrom } from "../src/utils/email.js";

function fakeBrevoApi(status = 201) {
  const received = { headers: null, body: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received.headers = req.headers;
      received.body = JSON.parse(raw || "{}");
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ messageId: "<fake@brevo>" }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/v3/smtp/email` }))
  );
}

test("brevo config: requires API key and a valid EMAIL_FROM", () => {
  assert.throws(() => assertEmailConfig({ EMAIL_PROVIDER: "brevo" }), /BREVO_API_KEY and EMAIL_FROM/);
  assert.throws(() => assertEmailConfig({ EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "k", EMAIL_FROM: "not an address" }), /EMAIL_FROM must look like/);
  assert.doesNotThrow(() => assertEmailConfig({ EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "k", EMAIL_FROM: "TalentOS <no-reply@example.com>" }));
  assert.deepEqual(parseFrom("TalentOS <no-reply@example.com>"), { name: "TalentOS", email: "no-reply@example.com" });
  assert.deepEqual(parseFrom("no-reply@example.com"), { email: "no-reply@example.com" });
});

test("brevo: posts the transactional payload with the api-key header", async () => {
  const { server, received, url } = await fakeBrevoApi(201);
  try {
    mock.method(console, "log", () => {});
    const env = { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "test-api-key", BREVO_API_URL: url, EMAIL_FROM: "TalentOS <no-reply@example.com>" };
    assert.equal(await sendEmail("ada@example.com", "Password Reset", body, { env }), true);
    assert.equal(received.headers["api-key"], "test-api-key");
    assert.deepEqual(received.body.sender, { name: "TalentOS", email: "no-reply@example.com" });
    assert.deepEqual(received.body.to, [{ email: "ada@example.com" }]);
    assert.equal(received.body.subject, "Password Reset");
    assert.ok(received.body.htmlContent.includes("SECRET123"));
    assert.ok(received.body.textContent.includes("SECRET123"));
  } finally {
    server.close();
  }
});

test("brevo: API errors and network failures return false and log no secrets", async () => {
  const lines = [];
  mock.method(console, "warn", (...args) => lines.push(args.join(" ")));
  const { server, url } = await fakeBrevoApi(401);
  try {
    const base = { EMAIL_PROVIDER: "brevo", BREVO_API_KEY: "test-api-key", EMAIL_FROM: "a@b.co" };
    assert.equal(await sendEmail("ada@example.com", "S", body, { env: { ...base, BREVO_API_URL: url } }), false);
    assert.equal(await sendEmail("ada@example.com", "S", body, { env: { ...base, BREVO_API_URL: "http://127.0.0.1:1/x" } }), false);
  } finally {
    server.close();
  }
  const out = lines.join("\n");
  assert.ok(out.includes("Brevo HTTP 401"));
  assert.equal(/test-api-key|SECRET123|ada@example\.com/.test(out), false);
});
