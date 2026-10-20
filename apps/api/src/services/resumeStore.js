import crypto from "node:crypto";
import mongoose from "mongoose";
import { Resume } from "../models/Resume.js";
import { isDatabaseReady } from "./userStore.js";

const memoryResumes = [];

const toResume = (resume) => ({
  id: String(resume._id ?? resume.id),
  companyId: String(resume.companyId),
  uploadedBy: resume.uploadedBy || null,
  filename: resume.filename,
  type: resume.type,
  size: resume.size,
  sha256: resume.sha256,
  storedName: resume.storedName,
  parsed: resume.parsed || {},
  confidence: resume.confidence || {},
  source: resume.source || "rules",
  warnings: resume.warnings || [],
  candidateId: resume.candidateId ? String(resume.candidateId) : null,
  createdAt: resume.createdAt ? new Date(resume.createdAt).toISOString() : null
});

export async function createResume(fields) {
  if (isDatabaseReady()) {
    return toResume(await Resume.create(fields));
  }
  const resume = { id: crypto.randomUUID(), createdAt: new Date(), ...fields };
  memoryResumes.push(resume);
  return toResume(resume);
}

export async function findResumeById(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const resume = await Resume.findById(id).lean();
    return resume ? toResume(resume) : null;
  }
  const resume = memoryResumes.find((item) => item.id === String(id));
  return resume ? toResume(resume) : null;
}

// The same file uploaded earlier by the same company (reuse its parse instead of parsing again).
export async function findResumeByHash(companyId, sha256) {
  if (isDatabaseReady()) {
    const resume = await Resume.findOne({ companyId: String(companyId), sha256 }).sort({ createdAt: -1 }).lean();
    return resume ? toResume(resume) : null;
  }
  const resume = [...memoryResumes].reverse().find((item) => item.companyId === String(companyId) && item.sha256 === sha256);
  return resume ? toResume(resume) : null;
}

export async function setResumeCandidate(id, candidateId) {
  if (isDatabaseReady()) {
    await Resume.findByIdAndUpdate(id, candidateId ? { candidateId: String(candidateId) } : { $unset: { candidateId: 1 } });
    return;
  }
  const resume = memoryResumes.find((item) => item.id === String(id));
  if (resume) resume.candidateId = candidateId ? String(candidateId) : undefined;
}

export async function deleteResume(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Resume.findByIdAndDelete(id));
  }
  const index = memoryResumes.findIndex((item) => item.id === String(id));
  if (index === -1) return false;
  memoryResumes.splice(index, 1);
  return true;
}
