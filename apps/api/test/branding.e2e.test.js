// End-to-end: per-company branding (details, colours, logo) for white labelling.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApi } from "./helpers/server.js";
import { cleanBranding, detectLogoType } from "../src/services/branding.js";

let api;
let admin;
let alice;
let bob;
let loner;
const ids = {};
const password = "Strong123";
// Smallest valid PNG header plus filler; only the leading bytes are inspected.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function register(client, name, email) {
  assert.equal((await client.post("/auth/signup", { name, email, password })).status, 201);
  return (await client.post("/auth/signin", { email, password })).data.user;
}

before(async () => {
  api = await startApi(process.env.E2E_MONGODB_URI ? { MONGODB_URI: process.env.E2E_MONGODB_URI } : {});
  [admin, alice, bob, loner] = [1, 2, 3, 4].map(() => api.client());
  await register(admin, "Admin", "admin@example.com");
  ids.alice = (await register(alice, "Alice", "alice@example.com")).id;
  ids.bob = (await register(bob, "Bob", "bob@example.com")).id;
  await register(loner, "Loner", "loner@example.com");
  ids.A = (await admin.post("/companies", { name: "Acme Hospital" })).data.company.id;
  ids.B = (await admin.post("/companies", { name: "Globex Care" })).data.company.id;
  await admin.patch(`/users/${ids.alice}`, { accessRole: "recruiter", companyId: ids.A });
  await admin.patch(`/users/${ids.bob}`, { accessRole: "recruiter", companyId: ids.B });
});

after(async () => {
  await api.stop();
});

test("validation helpers", () => {
  assert.equal(detectLogoType(png), "image/png");
  assert.equal(detectLogoType(Buffer.from("<svg onload=alert(1)>")), null);
  assert.deepEqual(cleanBranding({ primaryColor: "#ABCDEF" }).value, { primaryColor: "#abcdef" });
  for (const bad of [{ primaryColor: "red" }, { website: "javascript:alert(1)" }, { supportEmail: "nope" }, { tagline: "x".repeat(121) }]) {
    assert.ok(cleanBranding(bad).errors.length, JSON.stringify(bad));
  }
});

test("a company starts with the platform defaults and its own name", async () => {
  const { data } = await alice.get("/branding");
  assert.equal(data.branding.companyId, ids.A);
  assert.equal(data.branding.displayName, "Acme Hospital");
  assert.equal(data.branding.logo, null);
  assert.match(data.branding.primaryColor, /^#[0-9a-f]{6}$/);
});

test("users without a company get the platform default", async () => {
  const { data } = await loner.get("/branding");
  assert.equal(data.branding.companyId, null);
  assert.equal(data.branding.logo, null);
});

test("admins set details and colours; invalid values are refused; others cannot", async () => {
  const ok = await admin.patch(`/companies/${ids.A}`, {
    branding: { displayName: "Acme Health", tagline: "Care first", website: "https://acme.example.com", supportEmail: "hr@acme.example.com", phone: "+1 555 0100", address: "1 Main St", primaryColor: "#0F766E", accentColor: "#F59E0B" }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.company.branding.primaryColor, "#0f766e");
  for (const branding of [{ primaryColor: "teal" }, { website: "ftp://x" }, { supportEmail: "bad" }, { address: "x".repeat(201) }]) {
    assert.equal((await admin.patch(`/companies/${ids.A}`, { branding })).status, 400, JSON.stringify(branding));
  }
  assert.equal((await alice.patch(`/companies/${ids.A}`, { branding: { tagline: "x" } })).status, 403);
  const mine = (await alice.get("/branding")).data.branding;
  assert.equal(mine.displayName, "Acme Health");
  assert.equal(mine.accentColor, "#f59e0b");
});

test("each company only gets its own branding; admins can look at any company", async () => {
  assert.equal((await bob.get("/branding")).data.branding.displayName, "Globex Care");
  assert.equal((await bob.get(`/branding?companyId=${ids.A}`)).data.branding.companyId, ids.B, "non-admins cannot ask for another company");
  assert.equal((await admin.get(`/branding?companyId=${ids.A}`)).data.branding.displayName, "Acme Health");
});

test("logo upload: type decided by bytes, size limited, admin only, shown in branding, removable", async () => {
  const put = (client, body) => client.raw("PUT", `/companies/${ids.A}/logo`, body, { "content-type": "application/octet-stream" });
  assert.equal((await put(alice, png)).status, 403);
  assert.equal((await put(admin, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).status, 400);
  assert.equal((await put(admin, Buffer.alloc(0))).status, 400);
  assert.ok([400, 413].includes((await put(admin, Buffer.concat([png, Buffer.alloc(300 * 1024)]))).status));

  const ok = await put(admin, png);
  assert.equal(ok.status, 200);
  assert.match(ok.data.branding.logo, /^data:image\/png;base64,/);
  assert.match((await alice.get("/branding")).data.branding.logo, /^data:image\/png;base64,/);
  assert.equal((await bob.get("/branding")).data.branding.logo, null, "other company unaffected");

  const list = (await admin.get("/companies")).data.companies.find((c) => c.id === ids.A);
  assert.equal(list.hasLogo, true);
  assert.equal("logo" in list, false, "the image itself is never in the company list");

  assert.equal((await admin.delete(`/companies/${ids.A}/logo`)).status, 200);
  assert.equal((await alice.get("/branding")).data.branding.logo, null);
});

test("audit records the change without the image or colours", async () => {
  const { data } = await admin.get("/audit?limit=50");
  const entries = data.entries.filter((e) => e.action === "company.updated");
  assert.ok(entries.length >= 3);
  assert.ok(!JSON.stringify(entries).includes("base64"));
});
