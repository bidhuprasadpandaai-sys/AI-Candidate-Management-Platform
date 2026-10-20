// End-to-end: candidate documents with expiry dates, access rules and cleanup.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { makeDocx, makePdf } from "./helpers/fixtures.js";
import { startApi } from "./helpers/server.js";
import { cleanDocumentInput, documentExpiry, detectDocumentType } from "../src/services/documentRules.js";

let api;
let storage;
let admin;
let alice; // recruiter, company A
let hana; // hiring manager, company A
let vic; // read-only, company A
let bob; // recruiter, company B
const ids = {};
const password = "Strong123";
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const octet = { "content-type": "application/octet-stream" };

async function register(client, name, email) {
  assert.equal((await client.post("/auth/signup", { name, email, password })).status, 201);
  return (await client.post("/auth/signin", { email, password })).data.user;
}

const upload = (client, candidateId, body, query = "", name = "file") =>
  client.raw("POST", `/candidates/${candidateId}/documents${query}`, body, { ...octet, "x-filename": encodeURIComponent(name) });

before(async () => {
  storage = fs.mkdtempSync(path.join(os.tmpdir(), "acmp-docs-"));
  api = await startApi({ RESUME_STORAGE_DIR: storage, UPLOAD_RATE_LIMIT: "1000", ...(process.env.E2E_MONGODB_URI ? { MONGODB_URI: process.env.E2E_MONGODB_URI } : {}) });
  [admin, alice, hana, vic, bob] = [1, 2, 3, 4, 5].map(() => api.client());
  await register(admin, "Admin", "admin@example.com");
  for (const [client, name, email, key] of [
    [alice, "Alice", "alice@example.com", "alice"],
    [hana, "Hana", "hana@example.com", "hana"],
    [vic, "Vic", "vic@example.com", "vic"],
    [bob, "Bob", "bob@example.com", "bob"]
  ]) ids[key] = (await register(client, name, email)).id;
  ids.A = (await admin.post("/companies", { name: "Acme Hospital" })).data.company.id;
  ids.B = (await admin.post("/companies", { name: "Globex Care" })).data.company.id;
  const assign = (key, accessRole, companyId) => admin.patch(`/users/${ids[key]}`, { accessRole, companyId });
  await assign("alice", "recruiter", ids.A);
  await assign("hana", "hiring_manager", ids.A);
  await assign("vic", "viewer", ids.A);
  await assign("bob", "recruiter", ids.B);
  ids.cand = (await alice.post("/candidates", { name: "Ada Docs", email: "ada.docs@example.com", role: "Nurse" })).data.id;
});

after(async () => {
  await api.stop();
  fs.rmSync(storage, { recursive: true, force: true });
});

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test("rules: type from bytes, expiry states, input validation", async () => {
  assert.equal(await detectDocumentType(makePdf(["x"])), "pdf");
  assert.equal(await detectDocumentType(png), "png");
  assert.equal(await detectDocumentType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)])), "jpg");
  assert.equal(await detectDocumentType(await makeDocx(["hello world"])), "docx");
  assert.equal(await detectDocumentType(Buffer.from("PK\x03\x04 not really a docx......")), null);
  assert.equal(await detectDocumentType(Buffer.from("<svg onload=alert(1)></svg>")), null);
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(documentExpiry({ expiresAt: null }, now).status, "no_expiry");
  assert.equal(documentExpiry({ expiresAt: "2026-10-14" }, now).status, "expired");
  assert.equal(documentExpiry({ expiresAt: "2026-10-15" }, now).status, "expiring_soon", "the expiry day itself is still valid");
  assert.equal(documentExpiry({ expiresAt: "2026-11-14" }, now).status, "expiring_soon");
  assert.equal(documentExpiry({ expiresAt: "2026-11-16" }, now).status, "valid");
  assert.ok(cleanDocumentInput({ title: "", category: "other" }).errors.length);
  assert.ok(cleanDocumentInput({ title: "x", category: "nope" }).errors.length);
  assert.ok(cleanDocumentInput({ title: "x", category: "other", expiresAt: "2026-02-30" }).errors.length);
  assert.deepEqual(cleanDocumentInput({ expiresAt: "" }, { partial: true }).value, { expiresAt: null });
});

test("a recruiter uploads a document with an expiry date and it lists as valid", async () => {
  const res = await upload(alice, ids.cand, makePdf(["Nursing licence"]), `?title=${encodeURIComponent("Nursing licence")}&category=license&expiresAt=${day(90)}`, "licence.pdf");
  assert.equal(res.status, 201);
  const doc = res.data.document;
  assert.equal(doc.title, "Nursing licence");
  assert.equal(doc.category, "license");
  assert.equal(doc.type, "pdf");
  assert.equal(doc.status, "valid");
  assert.equal(doc.isExpired, false);
  assert.equal("storedName" in doc, false, "internal storage name is never exposed");
  ids.doc1 = doc.id;
  const list = await alice.get(`/candidates/${ids.cand}/documents`);
  assert.equal(list.data.documents.length, 1);
});

test("a document whose date has passed is marked Expired; today and near dates are not", async () => {
  const past = await upload(alice, ids.cand, png, `?title=Old%20ID&category=id_proof&expiresAt=${day(-1)}`, "id.png");
  assert.equal(past.data.document.status, "expired");
  assert.equal(past.data.document.isExpired, true);
  ids.expired = past.data.document.id;
  const today = await upload(alice, ids.cand, png, `?title=Today&category=other&expiresAt=${day(0)}`, "t.png");
  assert.equal(today.data.document.isExpired, false);
  const soon = await upload(alice, ids.cand, png, `?title=Soon&category=other&expiresAt=${day(10)}`, "s.png");
  assert.equal(soon.data.document.status, "expiring_soon");
  const none = await upload(alice, ids.cand, png, "?title=Forever&category=contract", "c.png");
  assert.equal(none.data.document.status, "no_expiry");
  ids.noExpiry = none.data.document.id;
});

test("changing the expiry date, title or category; clearing the date", async () => {
  const renewed = await alice.patch(`/documents/${ids.expired}`, { expiresAt: day(365), title: "Renewed ID" });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.data.document.status, "valid");
  assert.equal(renewed.data.document.title, "Renewed ID");
  assert.equal((await alice.patch(`/documents/${ids.expired}`, { expiresAt: null })).data.document.status, "no_expiry");
  const lapsed = await alice.patch(`/documents/${ids.expired}`, { expiresAt: day(-5) });
  assert.equal(lapsed.data.document.status, "expired");
  for (const body of [{}, { category: "nope" }, { expiresAt: "2026-13-01" }, { title: "" }, { expiresAt: "tomorrow" }]) {
    assert.equal((await alice.patch(`/documents/${ids.expired}`, body)).status, 400, JSON.stringify(body));
  }
});

test("invalid uploads are refused: bad type, empty body, missing category, bad date", async () => {
  assert.equal((await upload(alice, ids.cand, Buffer.from("<svg onload=alert(1)></svg>"), "?category=other", "x.svg")).status, 415);
  assert.equal((await upload(alice, ids.cand, Buffer.from("MZ executable"), "?category=other", "x.exe")).status, 415);
  assert.equal((await upload(alice, ids.cand, Buffer.alloc(0), "?category=other")).status, 400);
  assert.equal((await upload(alice, ids.cand, png, "?title=T")).status, 400);
  assert.equal((await upload(alice, ids.cand, png, "?title=T&category=other&expiresAt=31-12-2027")).status, 400);
});

test("downloads are attachments with a fixed type", async () => {
  const res = await alice.raw("GET", `/documents/${ids.doc1}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.res.headers.get("content-type"), "application/pdf");
  assert.match(res.res.headers.get("content-disposition"), /^attachment;/);
  assert.equal(res.res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.bytes.subarray(0, 5).toString(), "%PDF-");
});

test("access: company-scoped, hiring managers and read-only users can view but not change", async () => {
  assert.equal((await hana.get(`/candidates/${ids.cand}/documents`)).status, 200);
  assert.equal((await vic.raw("GET", `/documents/${ids.doc1}/file`)).status, 200);
  for (const client of [hana, vic]) {
    assert.equal((await upload(client, ids.cand, png, "?title=T&category=other")).status, 403);
    assert.equal((await client.patch(`/documents/${ids.doc1}`, { title: "x" })).status, 403);
    assert.equal((await client.delete(`/documents/${ids.doc1}`)).status, 403);
  }
  // another company cannot even tell it exists
  assert.equal((await bob.get(`/candidates/${ids.cand}/documents`)).status, 404);
  assert.equal((await bob.raw("GET", `/documents/${ids.doc1}/file`)).status, 404);
  assert.equal((await bob.patch(`/documents/${ids.doc1}`, { title: "x" })).status, 404);
  assert.equal((await bob.delete(`/documents/${ids.doc1}`)).status, 404);
  assert.equal((await upload(bob, ids.cand, png, "?title=T&category=other")).status, 404);
  // signed out
  assert.equal((await api.client().get(`/candidates/${ids.cand}/documents`)).status, 401);
  assert.equal((await api.client().raw("GET", `/documents/${ids.doc1}/file`)).status, 401);
  // admin sees everything
  assert.equal((await admin.get(`/candidates/${ids.cand}/documents`)).status, 200);
});

test("at most 20 documents per candidate", async () => {
  const cand = (await alice.post("/candidates", { name: "Many Docs", email: "many@example.com", role: "Nurse" })).data.id;
  for (let i = 0; i < 20; i += 1) assert.equal((await upload(alice, cand, png, `?title=D${i}&category=other`)).status, 201);
  assert.equal((await upload(alice, cand, png, "?title=One%20too%20many&category=other")).status, 409);
});

test("audit records the actions without file names or titles", async () => {
  const { data } = await admin.get("/audit?limit=200");
  const docEntries = data.entries.filter((e) => e.action.startsWith("document."));
  assert.ok(docEntries.some((e) => e.action === "document.uploaded"));
  assert.ok(docEntries.some((e) => e.action === "document.downloaded"));
  assert.ok(!JSON.stringify(docEntries).includes("licence.pdf"));
});

test("deleting a document or its candidate removes the files", async () => {
  const before = fs.readdirSync(storage).length;
  assert.equal((await alice.delete(`/documents/${ids.noExpiry}`)).status, 200);
  assert.equal(fs.readdirSync(storage).length, before - 1);
  assert.equal((await alice.raw("GET", `/documents/${ids.noExpiry}/file`)).status, 404);
  assert.equal((await alice.delete(`/candidates/${ids.cand}`)).status, 200);
  assert.equal((await alice.raw("GET", `/documents/${ids.doc1}/file`)).status, 404);
  assert.equal((await alice.get(`/candidates/${ids.cand}/documents`)).status, 404);
  const remaining = fs.readdirSync(storage);
  assert.equal(remaining.length, 20, "only the other candidate's 20 files remain; this candidate's files were deleted from disk");
});
