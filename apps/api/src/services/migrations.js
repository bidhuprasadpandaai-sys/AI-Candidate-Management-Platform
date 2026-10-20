import mongoose from "mongoose";

// Runs at startup (MongoDB only). Safe to run repeatedly.
//  1. Drops the old global unique index on candidate email: emails are unique per company now.
//  2. Turns teams from the earlier version into companies (same ids): users move to the team they were
//     in, candidates shared with a team move to it. The old `teams` collection is then renamed so the
//     migration does not run again.
export async function migrateTeamsToCompanies() {
  const result = { teams: 0, users: 0, candidates: 0 };
  const db = mongoose.connection.db;
  if (!db) return result;

  try {
    await db.collection("candidates").dropIndex("email_1");
  } catch {
    /* index already gone, or no candidates collection yet */
  }

  const hasTeams = (await db.listCollections({ name: "teams" }).toArray()).length > 0;
  if (!hasTeams) return result;

  const companies = db.collection("companies");
  const teams = await db.collection("teams").find({}).toArray();
  for (const team of teams) {
    if (!(await companies.findOne({ _id: team._id }))) {
      await companies.insertOne({
        _id: team._id,
        name: team.name,
        description: team.description || "",
        createdBy: team.createdBy,
        createdAt: team.createdAt || new Date(),
        updatedAt: new Date()
      });
    }
    const id = String(team._id);
    const users = await db
      .collection("users")
      .updateMany({ companyId: { $exists: false }, teamIds: id }, { $set: { companyId: id } });
    const candidates = await db
      .collection("candidates")
      .updateMany({ companyId: { $exists: false }, teamId: id }, { $set: { companyId: id } });
    result.teams += 1;
    result.users += users.modifiedCount;
    result.candidates += candidates.modifiedCount;
  }

  await db.collection("teams").rename("teams_migrated_to_companies");
  return result;
}

// A candidate used to be linked to one job through candidate.jobId. Each such link becomes an application
// (the candidate's current stage is kept), then the old field is removed. Safe to run repeatedly.
export async function migrateJobLinksToApplications() {
  const db = mongoose.connection.db;
  if (!db) return { applications: 0 };
  const candidates = db.collection("candidates");
  const applications = db.collection("applications");
  let created = 0;

  const linked = await candidates.find({ jobId: { $exists: true, $nin: [null, ""] } }).toArray();
  for (const candidate of linked) {
    const exists = await applications.findOne({ candidateId: String(candidate._id), jobId: String(candidate.jobId) });
    if (!exists && candidate.companyId) {
      const now = new Date();
      await applications.insertOne({
        companyId: String(candidate.companyId),
        candidateId: String(candidate._id),
        jobId: String(candidate.jobId),
        status: candidate.status || "screening",
        stage: candidate.stage || "Screening stage",
        createdAt: now,
        updatedAt: now
      });
      created += 1;
    }
    await candidates.updateOne({ _id: candidate._id }, { $unset: { jobId: 1 } });
  }
  return { applications: created };
}
