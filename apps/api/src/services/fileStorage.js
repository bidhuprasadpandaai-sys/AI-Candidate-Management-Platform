import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Stores uploaded files on local disk under random names (never the client's filename).
// RESUME_STORAGE_DIR overrides the location (default: apps/api/storage/resumes, git-ignored).
export function storageDir(env = process.env) {
  return env.RESUME_STORAGE_DIR
    ? path.resolve(env.RESUME_STORAGE_DIR)
    : fileURLToPath(new URL("../../storage/resumes", import.meta.url));
}

const SAFE_NAME = /^[a-f0-9-]{36}\.(?:pdf|docx|png|jpg)$/;

function fullPath(storedName) {
  if (!SAFE_NAME.test(storedName)) throw new Error("Invalid stored file name");
  return path.join(storageDir(), storedName);
}

export async function saveFile(buffer, extension) {
  const storedName = `${crypto.randomUUID()}.${extension}`;
  await fs.mkdir(storageDir(), { recursive: true, mode: 0o700 });
  await fs.writeFile(fullPath(storedName), buffer, { mode: 0o600, flag: "wx" });
  return storedName;
}

export async function readFile(storedName) {
  return fs.readFile(fullPath(storedName));
}

export async function removeFile(storedName) {
  try {
    await fs.unlink(fullPath(storedName));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
