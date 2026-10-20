// Usage: yarn set-role you@example.com [admin|recruiter|hiring_manager|viewer]   (default: admin)
// Sets a user's access role directly in the database, for the first admin or for recovery.
// Records an audit entry. Requires MONGODB_URI (the in-memory store has no persistent users).
import "../src/config/env.js";
import mongoose from "mongoose";
import { ROLES } from "@acmp/shared";
import { AuditLog } from "../src/models/AuditLog.js";
import { User } from "../src/models/User.js";

const [email, role = "admin"] = process.argv.slice(2);
if (!email || !ROLES.includes(role)) {
  console.error(`Usage: yarn set-role you@example.com [${ROLES.join("|")}]`);
  process.exit(2);
}
if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set; there are no persistent users to update.");
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
const user = await User.findOne({ email: email.trim().toLowerCase() });
if (!user) {
  console.error("No user with that email. Sign up first, then run this again.");
  await mongoose.disconnect();
  process.exit(1);
}

const before = user.accessRole || "recruiter (legacy default)";
user.accessRole = role;
await user.save();
await AuditLog.create({
  source: "system",
  action: "user.role_changed",
  entityType: "user",
  entityId: String(user._id),
  summary: `Role of ${user.email} set to ${role} from the command line`,
  meta: { accessRole: { from: before, to: role }, via: "cli" }
});
console.log(`${user.email}: ${before} -> ${role}`);
await mongoose.disconnect();
