// End-to-end tests for companies (tenants), roles, candidate ownership, audit log and OTP sign-in.
// Runs the real API (in-memory store by default) with a fake SMTP server.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nextMail, startApi } from "./helpers/server.js";

let api;
let admin;
let alice; // recruiter, Company A
let amy; // recruiter, Company A
let hana; // hiring manager, Company A
let vic; // read-only, Company A
let bob; // recruiter, Company B
let nora; // recruiter, no company yet
const ids = {};
const password = "Strong123";

async function register(client, name, email) {
  assert.equal((await client.post("/auth/signup", { name, email, password })).status, 201);
  const signin = await client.post("/auth/signin", { email, password });
  assert.equal(signin.status, 200);
  return signin.data.user;
}

// Set E2E_MONGODB_URI to a throwaway database to run the same scenarios against MongoDB.
before(async () => {
  api = await startApi(process.env.E2E_MONGODB_URI ? { MONGODB_URI: process.env.E2E_MONGODB_URI } : {});
  [admin, alice, amy, hana, vic, bob, nora] = [1, 2, 3, 4, 5, 6, 7].map(() => api.client());
});

after(async () => {
  await api.stop();
});

const names = (res) => res.data.candidates.map((c) => c.name);

test("first account becomes admin; later sign-ups are read-only and belong to no company", async () => {
  const adminUser = await register(admin, "Admin One", "admin@example.com");
  assert.equal(adminUser.accessRole, "admin");
  ids.admin = adminUser.id;
  for (const [client, name, email, key] of [
    [alice, "Alice", "alice@example.com", "alice"],
    [amy, "Amy", "amy@example.com", "amy"],
    [hana, "Hana Manager", "hana@example.com", "hana"],
    [vic, "Vic Viewer", "vic@example.com", "vic"],
    [bob, "Bob", "bob@example.com", "bob"],
    [nora, "Nora", "nora@example.com", "nora"]
  ]) {
    const user = await register(client, name, email);
    assert.equal(user.accessRole, "viewer", `${name} starts read-only`);
    assert.equal(user.companyId, null);
    ids[key] = user.id;
  }
  assert.equal((await vic.post("/candidates", { name: "X", email: "x@example.com", role: "R" })).status, 403);
});

test("only admins can manage users, companies and read the audit log", async () => {
  for (const client of [alice, hana, vic]) {
    assert.equal((await client.get("/users")).status, 403);
    assert.equal((await client.post("/companies", { name: "Nope" })).status, 403);
    assert.equal((await client.patch(`/companies/anything`, { name: "x" })).status, 403);
    assert.equal((await client.delete(`/companies/anything`)).status, 403);
    assert.equal((await client.get("/audit")).status, 403);
    assert.equal((await client.patch(`/users/${ids.alice}`, { accessRole: "admin" })).status, 403);
  }
  assert.equal((await admin.get("/users")).status, 200);
});

test("admin creates companies and puts each user under one company with a role", async () => {
  const a = await admin.post("/companies", { name: "Acme Corp", description: "Company A" });
  const b = await admin.post("/companies", { name: "Globex Ltd" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  ids.A = a.data.company.id;
  ids.B = b.data.company.id;
  assert.equal((await admin.post("/companies", { name: "acme corp" })).status, 409, "names are unique, case-insensitively");
  assert.equal((await admin.post("/companies", { name: "   " })).status, 400);
  assert.equal((await admin.patch(`/companies/${ids.A}`, { name: "Globex Ltd" })).status, 409);

  const assign = async (key, accessRole, companyId) =>
    assert.equal((await admin.patch(`/users/${ids[key]}`, { accessRole, companyId })).status, 200, key);
  await assign("alice", "recruiter", ids.A);
  await assign("amy", "recruiter", ids.A);
  await assign("hana", "hiring_manager", ids.A);
  await assign("vic", "viewer", ids.A);
  await assign("bob", "recruiter", ids.B);

  assert.equal((await admin.patch(`/users/${ids.alice}`, { accessRole: "boss" })).status, 400);
  assert.equal((await admin.patch(`/users/${ids.alice}`, { companyId: "no-such-company" })).status, 400);
  assert.equal((await admin.patch(`/users/${ids.alice}`, { companyId: { $ne: null } })).status, 400);

  const users = (await admin.get("/users")).data.users;
  assert.equal(users.find((u) => u.id === ids.alice).companyName, "Acme Corp");
  assert.equal(users.find((u) => u.id === ids.bob).companyName, "Globex Ltd");
  assert.equal((await alice.get("/auth/me")).data.user.companyName, "Acme Corp", "the change applies without signing in again");
});

test("non-admins only see their own company; admins see all with counts", async () => {
  assert.deepEqual((await alice.get("/companies")).data.companies.map((c) => c.name), ["Acme Corp"]);
  assert.deepEqual((await bob.get("/companies")).data.companies.map((c) => c.name), ["Globex Ltd"]);
  assert.deepEqual((await nora.get("/companies")).data.companies, []);
  const all = (await admin.get("/companies")).data.companies;
  assert.ok(all.some((c) => c.name === "Acme Corp" && c.userCount === 4));
  assert.ok(all.some((c) => c.name === "Globex Ltd" && c.userCount === 1));
});

test("a user without a company sees nothing and cannot create candidates", async () => {
  const list = await nora.get("/candidates");
  assert.equal(list.status, 200);
  assert.equal(list.data.candidates.length, 0);
  assert.equal((await nora.get("/dashboard")).data.metrics.totalCandidates, 0);
  await admin.patch(`/users/${ids.nora}`, { accessRole: "recruiter" });
  const create = await nora.post("/candidates", { name: "N", email: "n@example.com", role: "R" });
  assert.equal(create.status, 403);
  assert.match(create.data.message, /not assigned to a company/i);
  assert.equal((await nora.post("/chat", { message: "top candidates" })).status, 200);
});

test("candidates belong to the creator's company; admins must name the company", async () => {
  const noCompany = await admin.post("/candidates", { name: "Admin Cand", email: "ac@example.com", role: "Dev" });
  assert.equal(noCompany.status, 400);
  assert.equal((await admin.post("/candidates", { name: "Admin Cand", email: "ac@example.com", role: "Dev", companyId: "nope" })).status, 400);
  const fromAdmin = await admin.post("/candidates", { name: "Admin Cand", email: "ac@example.com", role: "Dev", companyId: ids.B });
  assert.equal(fromAdmin.status, 201);
  assert.equal(fromAdmin.data.companyName, "Globex Ltd");
  ids.cB = fromAdmin.data.id;

  // the body cannot choose another company for a non-admin
  const created = await alice.post("/candidates", { name: "Alice Candidate", email: "same@example.com", role: "Dev", companyId: ids.B, ownerId: ids.bob });
  assert.equal(created.status, 201);
  assert.equal(created.data.companyId, ids.A, "companyId in the body is ignored for non-admins");
  assert.equal(created.data.ownerId, ids.alice);
  ids.cA = created.data.id;

  // the same person can be a candidate at two companies; not twice in one
  assert.equal((await bob.post("/candidates", { name: "Same Person", email: "same@example.com", role: "Dev" })).status, 201);
  assert.equal((await amy.post("/candidates", { name: "Dup", email: "same@example.com", role: "Dev" })).status, 409);
});

test("company isolation: another company never sees, edits, deletes or counts these candidates", async () => {
  const bobList = await bob.get("/candidates");
  assert.ok(!names(bobList).includes("Alice Candidate"), "bob must not see company A candidates");
  assert.ok(names(bobList).includes("Admin Cand") && names(bobList).includes("Same Person"), "bob sees his own company's");
  assert.equal((await bob.put(`/candidates/${ids.cA}`, { status: "offer" })).status, 404);
  assert.equal((await bob.delete(`/candidates/${ids.cA}`)).status, 404);
  assert.equal((await bob.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.bob })).status, 404);
  assert.equal((await bob.get(`/candidates/${ids.cA}/audit`)).status, 404);
  assert.equal((await alice.put(`/candidates/${ids.cB}`, { status: "offer" })).status, 404);

  // counts and analytics only cover the caller's company
  const bobTotal = (await bob.get("/dashboard")).data.metrics.totalCandidates;
  assert.equal(bobTotal, 2);
  assert.equal((await bob.get("/analytics")).data.total, 2);
  assert.equal((await alice.get("/analytics")).data.total, 1);
  // search cannot reach across companies
  assert.equal((await bob.get("/candidates?search=Alice")).data.candidates.length, 0);
  // admins see everything, across companies
  const adminNames = names(await admin.get("/candidates"));
  assert.ok(adminNames.includes("Alice Candidate") && adminNames.includes("Admin Cand"));
});

test("inside a company everyone sees every candidate; roles decide what they can do", async () => {
  for (const client of [amy, hana, vic]) assert.ok(names(await client.get("/candidates")).includes("Alice Candidate"));

  // recruiters: edit company-wide, delete only their own
  assert.equal((await amy.put(`/candidates/${ids.cA}`, { stage: "Phone screen" })).status, 200);
  assert.equal((await amy.delete(`/candidates/${ids.cA}`)).status, 403);

  // hiring manager: notes only
  const note = await hana.put(`/candidates/${ids.cA}`, { notes: [{ text: "Strong interview", author: "Hana" }] });
  assert.equal(note.status, 200);
  assert.equal(note.data.notes.length, 1);
  assert.equal((await hana.put(`/candidates/${ids.cA}`, { status: "offer" })).status, 403);
  assert.equal((await hana.put(`/candidates/${ids.cA}`, { notes: [{ text: "x" }], score: 99 })).status, 403);
  assert.equal((await hana.delete(`/candidates/${ids.cA}`)).status, 403);
  assert.equal((await hana.post("/candidates", { name: "N", email: "n1@example.com", role: "R" })).status, 403);
  assert.equal((await hana.post("/conversations", { candidateIds: [ids.cA], title: "t" })).status, 403);

  // read-only: nothing
  for (const attempt of [
    vic.put(`/candidates/${ids.cA}`, { notes: [{ text: "hi" }] }),
    vic.put(`/candidates/${ids.cA}`, { status: "hired" }),
    vic.delete(`/candidates/${ids.cA}`),
    vic.post("/seed"),
    vic.get("/conversations")
  ]) assert.equal((await attempt).status, 403);
  assert.equal((await vic.get("/analytics")).data.total, 1);
});

test("owner rules: owners or recruiters (when unowned) assign only to themselves; admins assign within the company", async () => {
  // amy is not the owner, so she cannot take over
  assert.equal((await amy.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.amy })).status, 403);
  // alice (owner) cannot hand it to a colleague, only keep it
  assert.equal((await alice.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.amy })).status, 403);
  // company can only be changed by admins
  assert.equal((await alice.put(`/candidates/${ids.cA}/assignment`, { companyId: ids.B })).status, 403);

  // admin: owner must belong to the candidate's company
  assert.equal((await admin.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.bob })).status, 400);
  assert.equal((await admin.put(`/candidates/${ids.cA}/assignment`, { ownerId: "nobody" })).status, 400);
  const toAmy = await admin.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.amy });
  assert.equal(toAmy.status, 200);
  assert.equal(toAmy.data.ownerName, "Amy");

  // clear the owner; now any recruiter in the company can claim it, but not for someone else
  assert.equal((await admin.put(`/candidates/${ids.cA}/assignment`, { ownerId: null })).status, 200);
  assert.equal((await alice.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.amy })).status, 403);
  const claimed = await alice.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.alice });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.data.ownerName, "Alice");
  assert.equal((await hana.put(`/candidates/${ids.cA}/assignment`, { ownerId: ids.hana })).status, 403);
});

test("admin can move a candidate to another company; access follows the move", async () => {
  const c = (await alice.post("/candidates", { name: "Mover", email: "mover@example.com", role: "R" })).data;
  assert.equal(c.companyId, ids.A);
  const moved = await admin.put(`/candidates/${c.id}/assignment`, { companyId: ids.B });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.companyName, "Globex Ltd");
  assert.equal(moved.data.ownerId, null, "owner from the old company is cleared");
  assert.equal((await alice.put(`/candidates/${c.id}`, { stage: "x" })).status, 404, "alice lost access");
  assert.ok(names(await bob.get("/candidates")).includes("Mover"), "bob gained access");
  assert.equal((await admin.delete(`/candidates/${c.id}`)).status, 200);
});

test("the assistant only knows the caller's company and obeys the caller's role", async () => {
  const target = "Alice Candidate";
  const denied = await vic.post("/chat", { message: `Move ${target} to offer` });
  assert.equal(denied.data.actionExecuted, false);
  assert.match(denied.data.reply, /role does not allow/i);

  const other = await bob.post("/chat", { message: `Move ${target} to offer` });
  assert.equal(other.data.actionExecuted, false, "another company's candidate is unknown to bob's assistant");

  const before = (await alice.get("/candidates")).data.candidates.find((c) => c.id === ids.cA).status;
  assert.equal(before, "screening");
  const allowed = await alice.post("/chat", { message: `Move ${target} to offer` });
  assert.equal(allowed.data.actionExecuted, true);
  assert.equal((await alice.get("/candidates")).data.candidates.find((c) => c.id === ids.cA).status, "offer");

  const entry = (await admin.get("/audit?action=candidate.ai_update_status")).data.entries[0];
  assert.equal(entry.source, "ai");
  assert.equal(entry.actorEmail, "alice@example.com");
  assert.equal(entry.companyId, ids.A);
  assert.deepEqual(entry.meta.status, { from: "screening", to: "offer" });
});

test("conversations are company-scoped, need chat permission and never mix companies", async () => {
  const conv = await alice.post("/conversations", { candidateIds: [ids.cA], title: "Intro", type: "individual" });
  assert.equal(conv.status, 201);
  const id = conv.data.conversation.id;
  assert.equal((await amy.get(`/conversations/${id}/messages`)).status, 200, "same company can read it");
  assert.equal((await amy.post(`/conversations/${id}/messages`, { text: "Hello" })).status, 201);
  assert.equal((await bob.get(`/conversations/${id}/messages`)).status, 404);
  assert.equal((await bob.delete(`/conversations/${id}`)).status, 404);
  assert.ok(!(await bob.get("/conversations")).data.conversations.some((c) => c.id === id));
  assert.ok((await amy.get("/conversations")).data.conversations.some((c) => c.id === id));
  assert.ok((await admin.get("/conversations")).data.conversations.some((c) => c.id === id), "admin sees all");
  assert.equal((await bob.post("/conversations", { candidateIds: [ids.cA], title: "Sneaky" })).status, 400);
  const mixed = await admin.post("/conversations", { candidateIds: [ids.cA, ids.cB], title: "Mixed", type: "group" });
  assert.equal(mixed.status, 400);
  assert.match(mixed.data.message, /one company/i);
});

test("seeding resets only the demo company, never other companies' data", async () => {
  const mine = (await bob.get("/candidates")).data.candidates.length;
  assert.equal((await admin.post("/seed")).status, 201);
  assert.equal((await bob.get("/candidates")).data.candidates.length, mine, "bob's company is untouched");
  assert.ok(names(await alice.get("/candidates")).includes("Alice Candidate"));
  assert.ok((await admin.get("/companies")).data.companies.some((c) => c.name === "Demo Company"));
});

test("deactivation ends access at once; the last admin cannot be removed", async () => {
  assert.equal((await admin.patch(`/users/${ids.vic}`, { isActive: false })).status, 200);
  assert.equal((await vic.get("/candidates")).status, 401);
  assert.equal((await vic.post("/auth/signin", { email: "vic@example.com", password })).status, 403);
  assert.equal((await admin.patch(`/users/${ids.vic}`, { isActive: true })).status, 200);

  assert.equal((await admin.patch(`/users/${ids.admin}`, { accessRole: "recruiter" })).status, 409);
  assert.equal((await admin.patch(`/users/${ids.admin}`, { isActive: false })).status, 409);
  assert.equal((await admin.patch(`/users/${ids.alice}`, { accessRole: "admin" })).status, 200);
  assert.equal((await admin.patch(`/users/${ids.alice}`, { accessRole: "recruiter" })).status, 200);
});

test("a company with users or candidates cannot be deleted; an empty one can; adopt moves orphans", async () => {
  const empty = (await admin.post("/companies", { name: "Empty Co" })).data.company;
  assert.equal((await admin.post(`/companies/${empty.id}/adopt-unassigned`)).data.moved, 0);
  assert.equal((await admin.delete(`/companies/${ids.A}`)).status, 409);
  const withUser = (await admin.post("/companies", { name: "Temp Co" })).data.company;
  await admin.patch(`/users/${ids.nora}`, { companyId: withUser.id });
  const blocked = await admin.delete(`/companies/${withUser.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /1 user/);
  await admin.patch(`/users/${ids.nora}`, { companyId: null });
  assert.equal((await admin.delete(`/companies/${withUser.id}`)).status, 200);
  assert.equal((await admin.delete(`/companies/${empty.id}`)).status, 200);
  assert.equal((await admin.delete(`/companies/${empty.id}`)).status, 404);
});

test("audit log: complete, filterable by company, secret-free and append-only", async () => {
  const all = await admin.get("/audit?limit=200");
  assert.equal(all.status, 200);
  const actions = new Set(all.data.entries.map((e) => e.action));
  for (const expected of [
    "auth.signup", "auth.signin", "user.role_changed", "user.company_changed", "company.created", "company.deleted",
    "candidate.created", "candidate.updated", "candidate.assigned", "candidate.deleted", "candidate.ai_update_status", "data.seeded"
  ]) {
    assert.ok(actions.has(expected), `missing audit action ${expected}`);
  }
  const text = JSON.stringify(all.data);
  assert.equal(text.includes(password), false, "no passwords in the audit log");
  assert.equal(/passwordHash|otpHash|auth_token|resetToken/.test(text), false);

  const byCompany = await admin.get(`/audit?companyId=${ids.B}&limit=200`);
  assert.ok(byCompany.data.entries.length > 0 && byCompany.data.entries.every((e) => e.companyId === ids.B));
  const byActor = await admin.get(`/audit?actorId=${ids.alice}`);
  assert.ok(byActor.data.entries.length > 0 && byActor.data.entries.every((e) => e.actorId === ids.alice));
  assert.equal((await admin.get("/audit?actorId[$ne]=x")).status, 400, "query-operator objects are rejected");
  assert.equal((await admin.get("/audit?companyId[$ne]=x")).status, 400);

  const companyChange = all.data.entries.find((e) => e.action === "user.company_changed");
  assert.ok("companyId" in companyChange.meta);
  for (const method of ["put", "patch", "delete", "post"]) {
    const res = await admin[method]("/audit", {});
    assert.ok([404, 405].includes(res.status), `${method} /audit must not exist (got ${res.status})`);
  }
  assert.equal((await admin.delete(`/audit/${all.data.entries[0].id}`)).status, 404);
});

test("candidate activity feed: only for candidates the caller can see; emails are admin-only", async () => {
  const asAlice = await alice.get(`/candidates/${ids.cA}/audit`);
  assert.equal(asAlice.status, 200);
  assert.ok(asAlice.data.entries.length >= 3);
  assert.equal(asAlice.data.entries.some((e) => "actorEmail" in e), false);
  assert.ok((await admin.get(`/candidates/${ids.cA}/audit`)).data.entries.every((e) => "actorEmail" in e));
  assert.equal((await bob.get(`/candidates/${ids.cA}/audit`)).status, 404);
});

// ── OTP sign-in ───────────────────────────────────────────────────────────────

const getCode = (mail) => mail.match(/sign-in code is <strong>(\d{6})<\/strong>/)?.[1];

test("OTP: emailed 6-digit code signs in once, with the same session as a password", async () => {
  const user = api.client();
  api.smtp.received.data = "";
  const requested = await user.post("/auth/otp/request", { email: "alice@example.com" });
  assert.equal(requested.status, 200);
  const mail = await nextMail(api.smtp, { clear: true });
  assert.ok(mail.includes("To: alice@example.com") && mail.includes("Subject: Your TalentOS sign-in code"));
  const code = getCode(mail);
  assert.match(code, /^\d{6}$/);

  assert.equal((await user.get("/candidates")).status, 401, "not signed in yet");
  const wrong = await user.post("/auth/otp/verify", { email: "alice@example.com", code: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 401);
  const ok = await user.post("/auth/otp/verify", { email: "alice@example.com", code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, "alice@example.com");
  assert.equal(ok.data.user.passwordHash, undefined);
  assert.match(ok.res.headers.get("set-cookie"), /HttpOnly/i);
  assert.equal((await user.get("/candidates")).status, 200);

  assert.equal((await api.client().post("/auth/otp/verify", { email: "alice@example.com", code })).status, 401, "code is single-use");
  const signins = (await admin.get("/audit?action=auth.signin&limit=200")).data.entries;
  assert.ok(signins.some((e) => e.meta.method === "otp"));
});

test("OTP: unknown or invalid input looks the same, malformed codes are rejected", async () => {
  const c = api.client();
  const known = await c.post("/auth/otp/request", { email: "bob@example.com" });
  const unknown = await c.post("/auth/otp/request", { email: "nobody@example.com" });
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.data, unknown.data);
  assert.equal((await c.post("/auth/otp/request", { email: "not-an-email" })).status, 400);
  assert.equal((await c.post("/auth/otp/verify", { email: "bob@example.com", code: "12345" })).status, 400);
  assert.equal((await c.post("/auth/otp/verify", { email: "bob@example.com", code: "abcdef" })).status, 400);
  assert.equal((await c.post("/auth/otp/verify", { email: "nobody@example.com", code: "123456" })).status, 401);
});

test("OTP: five wrong guesses burn the code; resend has a one-minute cooldown", async () => {
  const c = api.client();
  api.smtp.received.data = "";
  await c.post("/auth/otp/request", { email: "hana@example.com" });
  const code = getCode(await nextMail(api.smtp, { clear: true }));
  assert.ok(code);
  const wrong = code === "123456" ? "654321" : "123456";
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await c.post("/auth/otp/verify", { email: "hana@example.com", code: wrong })).status, 401);
  }
  assert.equal((await c.post("/auth/otp/verify", { email: "hana@example.com", code })).status, 401, "correct code no longer works after 5 failures");

  // cooldown: a second request within a minute sends no new email
  api.smtp.received.data = "";
  await c.post("/auth/otp/request", { email: "hana@example.com" });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(api.smtp.received.data, "", "no second email within the cooldown");
});

test("OTP: disabled accounts cannot request or use codes", async () => {
  const c = api.client();
  await admin.patch(`/users/${ids.vic}`, { isActive: false });
  api.smtp.received.data = "";
  assert.equal((await c.post("/auth/otp/request", { email: "vic@example.com" })).status, 200);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(api.smtp.received.data, "", "no code is sent to a disabled account");
  await admin.patch(`/users/${ids.vic}`, { isActive: true });
});
