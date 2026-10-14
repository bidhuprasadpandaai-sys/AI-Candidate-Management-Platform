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
