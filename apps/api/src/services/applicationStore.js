import crypto from "node:crypto";
import mongoose from "mongoose";
import { Application } from "../models/Application.js";
import { isDatabaseReady } from "./userStore.js";

const memoryApplications = [];

const toApplication = (item) => ({
  id: String(item._id ?? item.id),
  companyId: String(item.companyId),
  candidateId: String(item.candidateId),
  jobId: String(item.jobId),
  status: item.status || "screening",
  stage: item.stage || "Screening stage",
  createdBy: item.createdBy || null,
  createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
  updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null
});

export const stageLabel = (status) => `${status.charAt(0).toUpperCase()}${status.slice(1)} stage`;

export async function listApplicationsByJob(jobId) {
  if (isDatabaseReady()) return (await Application.find({ jobId: String(jobId) }).sort({ createdAt: 1 }).lean()).map(toApplication);
  return memoryApplications.filter((item) => item.jobId === String(jobId)).map(toApplication);
}

export async function listApplicationsByCandidate(candidateId) {
  if (isDatabaseReady()) return (await Application.find({ candidateId: String(candidateId) }).sort({ createdAt: 1 }).lean()).map(toApplication);
  return memoryApplications.filter((item) => item.candidateId === String(candidateId)).map(toApplication);
}

// Applications of many candidates at once: Map(candidateId -> application[])
export async function listApplicationsByCandidates(candidateIds) {
  const ids = candidateIds.map(String);
  const rows = isDatabaseReady()
    ? (await Application.find({ candidateId: { $in: ids } }).sort({ createdAt: 1 }).lean()).map(toApplication)
    : memoryApplications.filter((item) => ids.includes(item.candidateId)).map(toApplication);
  const byCandidate = new Map();
  for (const row of rows) byCandidate.set(row.candidateId, [...(byCandidate.get(row.candidateId) || []), row]);
  return byCandidate;
}

export async function listAllApplications() {
  if (isDatabaseReady()) return (await Application.find({}).lean()).map(toApplication);
  return memoryApplications.map(toApplication);
}

export async function findApplicationById(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const item = await Application.findById(id).lean();
    return item ? toApplication(item) : null;
  }
  const item = memoryApplications.find((entry) => entry.id === String(id));
  return item ? toApplication(item) : null;
}

export async function findApplication(candidateId, jobId) {
  const all = await listApplicationsByCandidate(candidateId);
  return all.find((item) => item.jobId === String(jobId)) || null;
}

export async function createApplication(fields) {
  if (isDatabaseReady()) {
    try {
      return toApplication(await Application.create(fields));
    } catch (error) {
      if (error?.code === 11000) {
        const duplicate = new Error("duplicate");
        duplicate.code = 11000;
        throw duplicate;
      }
      throw error;
    }
  }
  if (memoryApplications.some((item) => item.candidateId === String(fields.candidateId) && item.jobId === String(fields.jobId))) {
    const duplicate = new Error("duplicate");
    duplicate.code = 11000;
    throw duplicate;
  }
  const now = new Date();
  const item = { id: crypto.randomUUID(), status: "screening", stage: stageLabel("screening"), ...fields, createdAt: now, updatedAt: now };
  memoryApplications.push(item);
  return toApplication(item);
}

export async function updateApplicationStatus(id, status) {
  const fields = { status, stage: stageLabel(status) };
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const item = await Application.findByIdAndUpdate(id, fields, { new: true }).lean();
    return item ? toApplication(item) : null;
  }
  const item = memoryApplications.find((entry) => entry.id === String(id));
  if (!item) return null;
  Object.assign(item, fields, { updatedAt: new Date() });
  return toApplication(item);
}

export async function deleteApplication(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Application.findByIdAndDelete(id));
  }
  const index = memoryApplications.findIndex((item) => item.id === String(id));
  if (index === -1) return false;
  memoryApplications.splice(index, 1);
  return true;
}

export async function deleteApplicationsByCandidate(candidateId) {
  if (isDatabaseReady()) {
    await Application.deleteMany({ candidateId: String(candidateId) });
    return;
  }
  for (let i = memoryApplications.length - 1; i >= 0; i -= 1) {
    if (memoryApplications[i].candidateId === String(candidateId)) memoryApplications.splice(i, 1);
  }
}

// Map(jobId -> { total, byStatus }) for the jobs list (board counts, delete guard)
export async function applicationStatsByJob() {
  const stats = new Map();
  for (const item of await listAllApplications()) {
    const entry = stats.get(item.jobId) || { total: 0, byStatus: {} };
    entry.total += 1;
    entry.byStatus[item.status] = (entry.byStatus[item.status] || 0) + 1;
    stats.set(item.jobId, entry);
  }
  return stats;
}
