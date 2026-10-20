// Needs MongoDB: set E2E_MONGODB_URI to a throwaway database (it is dropped at the end). Skipped otherwise.
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { migrateJobLinksToApplications, migrateTeamsToCompanies } from "../src/services/migrations.js";

const uri = process.env.E2E_MONGODB_URI;

test("teams from the earlier version become companies; users and candidates follow; idempotent", { skip: !uri }, async () => {
  await mongoose.connect(`${uri}-migration`, { serverSelectionTimeoutMS: 3000 });
  const db = mongoose.connection.db;
  try {
    await db.dropDatabase();
    const t1 = new mongoose.Types.ObjectId();
    const t2 = new mongoose.Types.ObjectId();
    await db.collection("teams").insertMany([
      { _id: t1, name: "Acme", description: "first", createdBy: "u0" },
      { _id: t2, name: "Globex" }
    ]);
    await db.collection("users").insertMany([
      { email: "a@x.com", teamIds: [String(t1)] },
      { email: "b@x.com", teamIds: [String(t2), String(t1)] },
      { email: "c@x.com", teamIds: [] },
      { email: "d@x.com", companyId: "already-set", teamIds: [String(t1)] }
    ]);
    await db.collection("candidates").createIndex({ email: 1 }, { unique: true });
    await db.collection("candidates").insertMany([
      { email: "k1@x.com", teamId: String(t1) },
      { email: "k2@x.com", teamId: String(t2) },
      { email: "k3@x.com" }
    ]);

    const result = await migrateTeamsToCompanies();
    assert.equal(result.teams, 2);

    const companies = await db.collection("companies").find({}).toArray();
    assert.deepEqual(companies.map((c) => c.name).sort(), ["Acme", "Globex"]);
    assert.ok(companies.some((c) => String(c._id) === String(t1)), "ids are preserved");

    const company = async (email) => (await db.collection("users").findOne({ email })).companyId;
    assert.equal(await company("a@x.com"), String(t1));
    assert.ok([String(t1), String(t2)].includes(await company("b@x.com")), "one company per user");
    assert.equal(await company("c@x.com"), undefined, "users without a team stay unassigned");
    assert.equal(await company("d@x.com"), "already-set", "existing assignments are not overwritten");

    const candidate = async (email) => (await db.collection("candidates").findOne({ email })).companyId;
    assert.equal(await candidate("k1@x.com"), String(t1));
    assert.equal(await candidate("k2@x.com"), String(t2));
    assert.equal(await candidate("k3@x.com"), undefined, "candidates without a team stay unassigned");

    // the global unique email index is gone: the same email can exist in two companies
    await db.collection("candidates").insertOne({ email: "k1@x.com", companyId: String(t2) });

    // the old collection is renamed, so a second run does nothing
    assert.equal((await db.listCollections({ name: "teams" }).toArray()).length, 0);
    const again = await migrateTeamsToCompanies();
    assert.equal(again.teams, 0);
    assert.equal((await db.collection("companies").countDocuments()), 2);
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});

test("old single-job links become applications that keep the candidate's stage; repeat runs add nothing", { skip: !uri }, async () => {
  await mongoose.connect(`${uri}-migration2`, { serverSelectionTimeoutMS: 3000 });
  const db = mongoose.connection.db;
  try {
    await db.dropDatabase();
    await db.collection("candidates").insertMany([
      { name: "A", companyId: "c1", jobId: "j1", status: "interview", stage: "Interview stage" },
      { name: "B", companyId: "c1", jobId: "j1", status: "offer" },
      { name: "C", companyId: "c1" },
      { name: "D", jobId: "j9", status: "screening" } // no company: skipped, but the old field is still removed
    ]);
    assert.deepEqual(await migrateJobLinksToApplications(), { applications: 2 });
    const apps = await db.collection("applications").find({}).toArray();
    assert.equal(apps.length, 2);
    const a = apps.find((x) => x.status === "interview");
    assert.equal(a.jobId, "j1");
    assert.equal(a.companyId, "c1");
    assert.equal(a.stage, "Interview stage");
    assert.equal(await db.collection("candidates").countDocuments({ jobId: { $exists: true } }), 0);
    assert.deepEqual(await migrateJobLinksToApplications(), { applications: 0 });
    assert.equal(await db.collection("applications").countDocuments(), 2);
  } finally {
    await db.dropDatabase();
    await mongoose.disconnect();
  }
});
