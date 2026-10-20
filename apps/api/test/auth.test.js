import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequireAuth, requirePermission } from "../src/middleware/requireAuth.js";
import { assertJwtSecret, getTokenTtlSeconds, signToken, verifyToken } from "../src/utils/jwt.js";

process.env.JWT_SECRET = "unit-test-secret-unit-test-secret-1234";

const users = {
  u1: { _id: "u1", email: "u1@example.com", name: "U One", accessRole: "recruiter", companyId: "c1" },
  gone: { _id: "gone", email: "gone@example.com", accessRole: "admin", isActive: false }
};
const requireAuth = createRequireAuth(async (id) => users[id] || null);

async function run(headers) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let nextCalled = false;
  const req = { headers };
  await requireAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test("jwt: sign and verify round trip", () => {
  const payload = verifyToken(signToken({ id: "u1" }));
  assert.equal(payload.id, "u1");
  assert.ok(payload.exp > payload.iat);
});

test("jwt: rejects tampered, malformed and expired tokens", () => {
  const token = signToken({ id: "u1" });
  const [h, , s] = token.split(".");
  const forged = `${h}.${Buffer.from(JSON.stringify({ id: "admin", exp: 9999999999 })).toString("base64url")}.${s}`;
  assert.equal(verifyToken(forged), null);
  assert.equal(verifyToken("a.b"), null);
  assert.equal(verifyToken(""), null);
  const expired = signToken({ id: "u1" }).split(".");
  const body = JSON.parse(Buffer.from(expired[1], "base64url").toString());
  body.exp = 1;
  assert.equal(verifyToken(`${expired[0]}.${Buffer.from(JSON.stringify(body)).toString("base64url")}.${expired[2]}`), null);
});

test("jwt: requires a 32+ char secret and clamps lifetime", () => {
  const saved = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "short";
  assert.throws(() => assertJwtSecret());
  process.env.JWT_SECRET = saved;
  process.env.JWT_EXPIRES_SECONDS = "999999999";
  assert.equal(getTokenTtlSeconds(), 24 * 60 * 60);
  delete process.env.JWT_EXPIRES_SECONDS;
  assert.equal(getTokenTtlSeconds(), 8 * 60 * 60);
});

test("requireAuth: 401 without or with a bad token", async () => {
  assert.equal((await run({})).res.statusCode, 401);
  assert.equal((await run({ authorization: "Bearer nope" })).res.statusCode, 401);
  assert.equal((await run({})).nextCalled, false);
});

test("requireAuth: loads the current user (role and teams) from the store, not the token", async () => {
  const token = signToken({ id: "u1", accessRole: "admin" });
  const viaHeader = await run({ authorization: `Bearer ${token}` });
  assert.equal(viaHeader.nextCalled, true);
  assert.deepEqual(viaHeader.req.user, { id: "u1", email: "u1@example.com", name: "U One", accessRole: "recruiter", companyId: "c1" });
  assert.equal((await run({ cookie: `other=1; auth_token=${encodeURIComponent(token)}` })).nextCalled, true);
});

test("requireAuth: rejects deleted or deactivated users and loader errors go to next()", async () => {
  assert.equal((await run({ authorization: `Bearer ${signToken({ id: "gone" })}` })).res.statusCode, 401);
  assert.equal((await run({ authorization: `Bearer ${signToken({ id: "missing" })}` })).res.statusCode, 401);
  const failing = createRequireAuth(async () => { throw new Error("db down"); });
  let error;
  await failing({ headers: { authorization: `Bearer ${signToken({ id: "u1" })}` } }, {}, (e) => { error = e; });
  assert.equal(error.message, "db down");
});

test("requirePermission: 403 when the role lacks it", () => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
  let called = false;
  requirePermission("user:manage")({ user: { accessRole: "recruiter" } }, res, () => { called = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
  requirePermission("candidate:read")({ user: { accessRole: "viewer" } }, res, () => { called = true; });
  assert.equal(called, true);
});
