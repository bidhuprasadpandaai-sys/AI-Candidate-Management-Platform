// End-to-end: company currency and facility lists, the new job fields, bill-rate privacy,
// and the expiry / maximum-application rules. Runs the real API (in-memory by default).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApi } from "./helpers/server.js";

let api;
let admin;
let alice; // recruiter, company A
let hana; // hiring manager, company A
let vic; // read-only, company A
let bob; // recruiter, company B
const ids = {};
const password = "Strong123";

async function register(client, name, email) {
  assert.equal((await client.post("/auth/signup", { name, email, password })).status, 201);
  return (await client.post("/auth/signin", { email, password })).data.user;
}

before(async () => {
  api = await startApi(process.env.E2E_MONGODB_URI ? { MONGODB_URI: process.env.E2E_MONGODB_URI } : {});
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
});

after(async () => {
  await api.stop();
});

const future = "2099-12-31";

test("a new company offers USD and has no facilities until an admin sets them", async () => {
  const company = (await admin.get("/companies")).data.companies.find((c) => c.id === ids.A);
  assert.deepEqual(company.currencies, ["USD"]);
  assert.deepEqual(company.facilities, []);
});

test("admins set each company's currency list and facility list; invalid lists are refused", async () => {
  const a = await admin.patch(`/companies/${ids.A}`, { currencies: ["usd", "EUR", "usd"], facilities: [{ name: "Main Hospital" }, { name: "North Clinic" }] });
  assert.equal(a.status, 200);
  assert.deepEqual(a.data.company.currencies, ["USD", "EUR"], "upper-cased and de-duplicated");
  assert.equal(a.data.company.facilities.length, 2);
  assert.ok(a.data.company.facilities.every((f) => /^[0-9a-f-]{36}$/.test(f.id)), "each facility gets an id");
  ids.hq = a.data.company.facilities[0].id;
  ids.north = a.data.company.facilities[1].id;

  const b = await admin.patch(`/companies/${ids.B}`, { currencies: ["GBP"], facilities: [{ name: "London Office" }] });
  assert.equal(b.status, 200);
  ids.london = b.data.company.facilities[0].id;

  for (const body of [
    { currencies: [] }, { currencies: ["XXX"] }, { currencies: "USD" }, { currencies: Array(11).fill("USD").map((c, i) => ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "INR", "SGD", "AED", "CHF", "JPY"][i]) },
    { facilities: [{ name: "A" }, { name: "a" }] }, { facilities: [{ name: "  " }] }, { facilities: [{ name: "x".repeat(81) }] },
    { facilities: "HQ" }, { facilities: Array(51).fill(0).map((_, i) => ({ name: `Site ${i}` })) }
  ]) assert.equal((await admin.patch(`/companies/${ids.A}`, body)).status, 400, JSON.stringify(body).slice(0, 60));

  assert.equal((await alice.patch(`/companies/${ids.A}`, { currencies: ["USD"] })).status, 403);
});

test("each company sees only its own lists", async () => {
  assert.deepEqual((await alice.get("/companies")).data.companies.map((c) => [c.name, c.currencies, c.facilities.map((f) => f.name)]), [["Acme Hospital", ["USD", "EUR"], ["Main Hospital", "North Clinic"]]]);
  assert.deepEqual((await bob.get("/companies")).data.companies.map((c) => [c.name, c.currencies, c.facilities.map((f) => f.name)]), [["Globex Care", ["GBP"], ["London Office"]]]);
});

test("a job stores employment type, rates, currency, facility, expiry and application limit", async () => {
  const created = await alice.post("/jobs", {
    title: "Registered Nurse", employmentType: "part_time", currency: "EUR", rateUnit: "hour",
    payRateMin: 40, payRateMax: "60.5", billRateMin: 70, billRateMax: 90,
    facilityId: ids.hq, expiresAt: future, maxApplications: 2
  });
  assert.equal(created.status, 201);
  const job = created.data.job;
  assert.deepEqual(
    [job.employmentType, job.currency, job.rateUnit, job.payRateMin, job.payRateMax, job.billRateMin, job.billRateMax, job.facilityId, job.facilityName, job.expiresAt, job.maxApplications],
    ["part_time", "EUR", "hour", 40, 60.5, 70, 90, ids.hq, "Main Hospital", future, 2]
  );
  assert.equal(job.isExpired, false);
  assert.equal(job.isFull, false);
  ids.job = job.id;

  const plain = (await alice.post("/jobs", { title: "Cleaner" })).data.job;
  assert.deepEqual([plain.employmentType, plain.rateUnit, plain.currency, plain.payRateMin, plain.facilityId, plain.expiresAt, plain.maxApplications], ["full_time", "hour", null, null, null, null, null]);
});

test("a rate without a currency uses the company's first currency", async () => {
  const job = (await alice.post("/jobs", { title: "Porter", payRateMin: 15 })).data.job;
  assert.equal(job.currency, "USD");
});

test("currency and facility must come from the job's own company", async () => {
  const bad = (client, body) => client.post("/jobs", { title: "X", ...body });
  assert.equal((await bad(alice, { currency: "GBP", payRateMin: 1 })).status, 400, "GBP is not in company A's list");
  assert.match((await bad(alice, { currency: "GBP" })).data.error, /USD, EUR/);
  assert.equal((await bad(alice, { facilityId: ids.london })).status, 400, "another company's facility");
  assert.equal((await bad(alice, { facilityId: "nope" })).status, 400);
  assert.equal((await bad(bob, { facilityId: ids.hq })).status, 400);
  assert.equal((await bad(bob, { currency: "GBP", facilityId: ids.london })).status, 201);
  assert.equal((await bad(bob, { currency: "USD" })).status, 400, "company B only offers GBP");
});

test("rate, date and limit validation on create", async () => {
  const bad = (body, pattern) => alice.post("/jobs", { title: "X", ...body }).then((r) => {
    assert.equal(r.status, 400, JSON.stringify(body));
    if (pattern) assert.match(r.data.error, pattern);
  });
  await bad({ payRateMin: 50, payRateMax: 40 }, /pay rate/);
  await bad({ billRateMin: 90, billRateMax: 80 }, /bill rate/);
  await bad({ payRateMin: -5 });
  await bad({ employmentType: "contract" });
  await bad({ expiresAt: "2020-01-01" }, /past/);
  await bad({ expiresAt: "2026-02-30" });
  await bad({ maxApplications: 0 });
  await bad({ maxApplications: 2.5 });
  await bad({ rateUnit: "fortnight" });
  assert.equal((await alice.post("/jobs", { title: "Today is fine", expiresAt: new Date().toISOString().slice(0, 10) })).status, 201);
});

test("bill rates are only visible to people who manage jobs; pay rates are visible to the company", async () => {
  for (const client of [hana, vic]) {
    const job = (await client.get(`/jobs/${ids.job}`)).data.job;
    assert.equal(job.billRateMin, null);
    assert.equal(job.billRateMax, null);
    assert.equal(job.payRateMin, 40);
    assert.equal(job.payRateMax, 60.5);
    const listed = (await client.get("/jobs")).data.jobs.find((j) => j.id === ids.job);
    assert.equal(listed.billRateMax, null);
    assert.equal(listed.currency, "EUR");
  }
  for (const client of [alice, admin]) assert.equal((await client.get(`/jobs/${ids.job}`)).data.job.billRateMax, 90);
});

test("updates: change and clear fields; rules are re-checked against the company", async () => {
  const up = await alice.patch(`/jobs/${ids.job}`, { payRateMax: 65, facilityId: ids.north, employmentType: "full_time" });
  assert.equal(up.status, 200);
  assert.equal(up.data.job.facilityName, "North Clinic");
  assert.equal(up.data.job.payRateMax, 65);
  assert.equal((await alice.patch(`/jobs/${ids.job}`, { payRateMin: 99 })).status, 400, "min above the saved max");
  assert.equal((await alice.patch(`/jobs/${ids.job}`, { currency: "GBP" })).status, 400);
  assert.equal((await alice.patch(`/jobs/${ids.job}`, { expiresAt: "2020-01-01" })).status, 400, "cannot move the expiry into the past");
  const cleared = (await alice.patch(`/jobs/${ids.job}`, { billRateMin: null, billRateMax: null, facilityId: null, expiresAt: null })).data.job;
  assert.deepEqual([cleared.billRateMin, cleared.billRateMax, cleared.facilityId, cleared.facilityName, cleared.expiresAt], [null, null, null, null, null]);
  await alice.patch(`/jobs/${ids.job}`, { billRateMin: 70, billRateMax: 90, facilityId: ids.hq, expiresAt: future });
  for (const client of [hana, vic]) assert.equal((await client.patch(`/jobs/${ids.job}`, { payRateMax: 1 })).status, 403);
  assert.equal((await bob.patch(`/jobs/${ids.job}`, { payRateMax: 1 })).status, 404);
});

test("the maximum application count stops further applications, including the create-candidate shortcut", async () => {
  const cands = [];
  for (const n of [1, 2, 3, 4]) cands.push((await alice.post("/candidates", { name: `Cand ${n}`, email: `c${n}@example.com`, role: "Nurse" })).data);
  const apply = (c) => alice.post(`/candidates/${c.id}/applications`, { jobId: ids.job });

  assert.equal((await apply(cands[0])).status, 201);
  assert.equal((await alice.get(`/jobs/${ids.job}`)).data.job.isFull, false);
  assert.equal((await apply(cands[1])).status, 201);
  const full = (await alice.get(`/jobs/${ids.job}`)).data.job;
  assert.equal(full.isFull, true);
  assert.equal(full.candidateCount, 2);

  const refused = await apply(cands[2]);
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /maximum of 2 applications/);
  const shortcut = await alice.post("/candidates", { name: "Via Popup", email: "popup@example.com", role: "Nurse", jobId: ids.job });
  assert.equal(shortcut.status, 400);
  assert.match(shortcut.data.message, /maximum of 2/);

  // removing one makes room; raising the limit makes more room
  const rows = (await alice.get(`/jobs/${ids.job}/applications`)).data.applications;
  assert.equal((await alice.delete(`/applications/${rows[0].id}`)).status, 200);
  assert.equal((await apply(cands[2])).status, 201);
  assert.equal((await apply(cands[3])).status, 400);
  assert.equal((await alice.patch(`/jobs/${ids.job}`, { maxApplications: 5 })).status, 200);
  assert.equal((await apply(cands[3])).status, 201);
  assert.equal((await alice.patch(`/jobs/${ids.job}`, { maxApplications: null })).data.job.isFull, false);
});

test("draft, on-hold and closed jobs take no applications", async () => {
  const cand = (await alice.post("/candidates", { name: "Status Test", email: "status@example.com", role: "Nurse" })).data;
  for (const [status, pattern] of [["draft", /still a draft/], ["on_hold", /on hold/], ["closed", /closed/]]) {
    await alice.patch(`/jobs/${ids.job}`, { status });
    const res = await alice.post(`/candidates/${cand.id}/applications`, { jobId: ids.job });
    assert.equal(res.status, 400, status);
    assert.match(res.data.error, pattern);
  }
  await alice.patch(`/jobs/${ids.job}`, { status: "open" });
  assert.equal((await alice.post(`/candidates/${cand.id}/applications`, { jobId: ids.job })).status, 201);
});

test("a currency or facility that jobs use cannot be removed; renaming keeps the link; unused ones can go", async () => {
  const usedFacility = await admin.patch(`/companies/${ids.A}`, { facilities: [{ id: ids.north, name: "North Clinic" }] });
  assert.equal(usedFacility.status, 409, "the Main Hospital facility is used by a job");
  assert.match(usedFacility.data.error, /Main Hospital/);
  const usedCurrency = await admin.patch(`/companies/${ids.A}`, { currencies: ["USD"] });
  assert.equal(usedCurrency.status, 409, "EUR is used by a job");
  assert.match(usedCurrency.data.error, /EUR/);

  // rename the facility by id: jobs keep pointing at it and show the new name
  const renamed = await admin.patch(`/companies/${ids.A}`, { facilities: [{ id: ids.hq, name: "Main Hospital (Renamed)" }, { id: ids.north, name: "North Clinic" }] });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.company.facilities[0].id, ids.hq);
  assert.equal((await alice.get(`/jobs/${ids.job}`)).data.job.facilityName, "Main Hospital (Renamed)");

  // the unused facility can be removed; unused currencies too
  assert.equal((await admin.patch(`/companies/${ids.A}`, { facilities: [{ id: ids.hq, name: "Main Hospital (Renamed)" }] })).status, 200);
  assert.equal((await alice.get("/companies")).data.companies[0].facilities.length, 1);
});

test("changes to job rules are audited without leaking more than field names", async () => {
  const entries = (await admin.get("/audit?limit=200")).data.entries;
  assert.ok(entries.some((e) => e.action === "job.created"));
  assert.ok(entries.some((e) => e.action === "job.updated" && e.meta.changed.includes("payRateMax")));
  assert.ok(entries.some((e) => e.action === "company.updated" && e.meta.changed.includes("facilities")));
  const text = JSON.stringify(entries.filter((e) => e.action.startsWith("job.")));
  assert.equal(/"(bill|pay)Rate(Min|Max)":/.test(text), false, "rate values are not copied into the audit log (only field names)");
});

test("facilities carry name, location, address and pin code, and belong to their own company", async () => {
  const current = (await admin.get("/companies")).data.companies.find((c) => c.id === ids.B).facilities; // jobs may use these, so keep their ids
  const set = await admin.patch(`/companies/${ids.B}`, {
    facilities: [...current.map((f) => (f.name === "London Office" ? { ...f, location: "London", address: "1 Fleet Street", pinCode: "EC4A 1AB" } : f)), { name: "Leeds Hub" }]
  });
  assert.equal(set.status, 200);
  const london = set.data.company.facilities.find((f) => f.name === "London Office");
  const leeds = set.data.company.facilities.find((f) => f.name === "Leeds Hub");
  assert.equal(london.id, current.find((f) => f.name === "London Office").id, "the id is kept");
  assert.deepEqual([london.location, london.address, london.pinCode], ["London", "1 Fleet Street", "EC4A 1AB"]);
  assert.deepEqual([leeds.location, leeds.address, leeds.pinCode], ["", "", ""], "everything but the name is optional");
  for (const bad of [{ name: "X", pinCode: "!!" }, { name: "X", pinCode: "1" }, { name: "X", location: "l".repeat(81) }, { name: "X", address: "a".repeat(201) }, { name: "X", address: 5 }]) {
    assert.equal((await admin.patch(`/companies/${ids.B}`, { facilities: [bad] })).status, 400, JSON.stringify(bad).slice(0, 50));
  }
});

test("a recruiter adds a facility to their own company only; duplicates and other companies are refused", async () => {
  const created = await bob.post(`/companies/${ids.B}/facilities`, { name: "Bristol Clinic", location: "Bristol", address: "2 Quay Street", pinCode: "BS1 4ST" });
  assert.equal(created.status, 201);
  assert.equal(created.data.facility.location, "Bristol");
  assert.ok(created.data.facilities.some((f) => f.name === "Bristol Clinic"));
  assert.ok(/^[0-9a-f-]{36}$/.test(created.data.facility.id));

  assert.equal((await bob.post(`/companies/${ids.B}/facilities`, { name: "bristol clinic" })).status, 409, "same name, any case");
  assert.equal((await bob.post(`/companies/${ids.B}/facilities`, { name: "" })).status, 400);
  assert.equal((await bob.post(`/companies/${ids.B}/facilities`, { name: "Bad pin", pinCode: "@@" })).status, 400);
  // company A's recruiter cannot add to company B (404: it is not theirs), nor can a read-only or hiring-manager user
  assert.equal((await alice.post(`/companies/${ids.B}/facilities`, { name: "Sneaky" })).status, 404);
  assert.equal((await hana.post(`/companies/${ids.A}/facilities`, { name: "Nope" })).status, 403);
  assert.equal((await vic.post(`/companies/${ids.A}/facilities`, { name: "Nope" })).status, 403);
  assert.equal((await api.client().post(`/companies/${ids.A}/facilities`, { name: "Nope" })).status, 401);
  // the new facility is not visible to company A
  assert.ok(!(await alice.get("/companies")).data.companies[0].facilities.some((f) => f.name === "Bristol Clinic"));
  // an admin can add to any company
  assert.equal((await admin.post(`/companies/${ids.A}/facilities`, { name: "Admin Added", location: "Dallas" })).status, 201);
});

test("a job can use a facility that a recruiter just added, and shows its location", async () => {
  const facility = (await bob.post(`/companies/${ids.B}/facilities`, { name: "Cardiff Site", location: "Cardiff" })).data.facility;
  const job = await bob.post("/jobs", { title: "Site Nurse", facilityId: facility.id });
  assert.equal(job.status, 201);
  assert.equal(job.data.job.facilityName, "Cardiff Site");
  assert.equal(job.data.job.facilityLocation, "Cardiff");
  // a facility of another company is still refused on a job
  assert.equal((await alice.post("/jobs", { title: "Wrong site", facilityId: facility.id })).status, 400);
});
