import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Import this module first: ES module imports run in order, so every later module
// (routes, utils) sees the loaded variables. The first file listed wins, and real
// process environment variables always win over both files.
const apiEnv = fileURLToPath(new URL("../../.env", import.meta.url));
const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));

dotenv.config({ path: [apiEnv, rootEnv], quiet: true });
