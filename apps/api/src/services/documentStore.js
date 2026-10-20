import crypto from "node:crypto";
import mongoose from "mongoose";
import { CandidateDocument } from "../models/CandidateDocument.js";
import { isDatabaseReady } from "./userStore.js";

const memoryDocuments = [];

const toDocument = (doc) => ({
  id: String(doc._id ?? doc.id),
  companyId: String(doc.companyId),
  candidateId: String(doc.candidateId),
  uploadedBy: doc.uploadedBy || null,
  title: doc.title,
  category: doc.category,
  filename: doc.filename,
  type: doc.type,
  size: doc.size,
  storedName: doc.storedName,
  expiresAt: doc.expiresAt || null,
  createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null
});

export async function createDocument(fields) {
  if (isDatabaseReady()) return toDocument(await CandidateDocument.create(fields));
  const doc = { id: crypto.randomUUID(), createdAt: new Date(), ...fields };
  memoryDocuments.push(doc);
  return toDocument(doc);
}

export async function findDocumentById(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await CandidateDocument.findById(id).lean();
    return doc ? toDocument(doc) : null;
  }
  const doc = memoryDocuments.find((item) => item.id === String(id));
  return doc ? toDocument(doc) : null;
}

export async function listDocumentsByCandidate(candidateId) {
  if (isDatabaseReady()) {
    return (await CandidateDocument.find({ candidateId: String(candidateId) }).sort({ createdAt: -1 }).lean()).map(toDocument);
  }
  return memoryDocuments.filter((item) => item.candidateId === String(candidateId)).map(toDocument).reverse();
}

export async function updateDocument(id, { title, category, expiresAt }) {
  const update = {};
  if (title !== undefined) update.title = title;
  if (category !== undefined) update.category = category;
  if (expiresAt !== undefined) update.expiresAt = expiresAt;
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await CandidateDocument.findByIdAndUpdate(id, update, { new: true }).lean();
    return doc ? toDocument(doc) : null;
  }
  const doc = memoryDocuments.find((item) => item.id === String(id));
  if (!doc) return null;
  Object.assign(doc, update);
  return toDocument(doc);
}

export async function deleteDocument(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await CandidateDocument.findByIdAndDelete(id));
  }
  const index = memoryDocuments.findIndex((item) => item.id === String(id));
  if (index === -1) return false;
  memoryDocuments.splice(index, 1);
  return true;
}

// Removes every document of a candidate and returns them (so their files can be deleted too).
export async function deleteDocumentsByCandidate(candidateId) {
  const docs = await listDocumentsByCandidate(candidateId);
  if (isDatabaseReady()) {
    await CandidateDocument.deleteMany({ candidateId: String(candidateId) });
  } else {
    for (let i = memoryDocuments.length - 1; i >= 0; i -= 1) if (memoryDocuments[i].candidateId === String(candidateId)) memoryDocuments.splice(i, 1);
  }
  return docs;
}
