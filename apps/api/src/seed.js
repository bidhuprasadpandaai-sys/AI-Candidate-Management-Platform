import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import { seedCandidates } from "./data/seedCandidates.js";
import { Candidate } from "./models/Candidate.js";

dotenv.config();

const connected = await connectDB();

if (!connected) {
  console.log("Skipping database seed because MONGODB_URI is not configured.");
  process.exit(0);
}

await Candidate.deleteMany({});
await Candidate.insertMany(seedCandidates);
console.log(`Seeded ${seedCandidates.length} candidates into MongoDB.`);
process.exit(0);
