import crypto from "node:crypto";
import mongoose from "mongoose";
import { Job } from "../models/Job.js";
import { isDatabaseReady } from "./userStore.js";

const memoryJobs = [];

const toJob = (job) => ({
  id: String(job._id ?? job.id),
  companyId: String(job.companyId),
  title: job.title,
  department: job.department || "",
  location: job.location || "",
  status: job.status || "open",
  hiringManagerId: job.hiringManagerId ? String(job.hiringManagerId) : null,
  description: job.description || "",
  employmentType: job.employmentType || "full_time",
  currency: job.currency || null,
  rateUnit: job.rateUnit || "hour",
  payRateMin: job.payRateMin ?? null,
  payRateMax: job.payRateMax ?? null,
  billRateMin: job.billRateMin ?? null,
  billRateMax: job.billRateMax ?? null,
  facilityId: job.facilityId || null,
  expiresAt: job.expiresAt || null,
  maxApplications: job.maxApplications ?? null,
  createdBy: job.createdBy || null,
  createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
  updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null
});

// companyId: only that company's jobs; undefined: all jobs (admins)
export async function listJobs({ companyId } = {}) {
  if (isDatabaseReady()) {
    const query = companyId ? { companyId: String(companyId) } : {};
    return (await Job.find(query).sort({ createdAt: -1 }).lean()).map(toJob);
  }
  return memoryJobs
    .filter((job) => !companyId || job.companyId === String(companyId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(toJob);
}

export async function findJobById(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    return mongoose.isValidObjectId(id) ? (await Job.findById(id).lean().then((job) => (job ? toJob(job) : null))) : null;
  }
  const job = memoryJobs.find((item) => item.id === String(id));
  return job ? toJob(job) : null;
}

export async function createJob(fields) {
  if (isDatabaseReady()) {
    return toJob(await Job.create(fields));
  }
  const now = new Date();
  const job = { id: crypto.randomUUID(), status: "open", ...fields, createdAt: now, updatedAt: now };
  memoryJobs.push(job);
  return toJob(job);
}

export async function updateJob(id, fields) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const update = { $set: {}, $unset: {} };
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) update.$unset[key] = 1;
      else update.$set[key] = value;
    }
    if (!Object.keys(update.$set).length) delete update.$set;
    if (!Object.keys(update.$unset).length) delete update.$unset;
    const job = await Job.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean();
    return job ? toJob(job) : null;
  }
  const job = memoryJobs.find((item) => item.id === String(id));
  if (!job) return null;
  for (const [key, value] of Object.entries(fields)) job[key] = value === null ? undefined : value;
  job.updatedAt = new Date();
  return toJob(job);
}

export async function deleteJob(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Job.findByIdAndDelete(id));
  }
  const index = memoryJobs.findIndex((job) => job.id === String(id));
  if (index === -1) return false;
  memoryJobs.splice(index, 1);
  return true;
}
