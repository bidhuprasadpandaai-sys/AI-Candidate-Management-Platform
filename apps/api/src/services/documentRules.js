import JSZip from "jszip";
import { DOCUMENT_CATEGORIES } from "@acmp/shared";
import { todayUtc } from "./jobRules.js";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_CANDIDATE = 20;
export const EXPIRING_SOON_DAYS = 30;

export const DOCUMENT_TYPES = {
  pdf: { mime: "application/pdf", extension: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
  png: { mime: "image/png", extension: "png" },
  jpg: { mime: "image/jpeg", extension: "jpg" }
};

// The type comes from the bytes, never from the name or Content-Type. A zip must really be a Word file.
export async function detectDocumentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      return zip.file("word/document.xml") ? "docx" : null;
    } catch {
      return null;
    }
  }
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value) {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Validates title, category and expiry date. `partial` allows leaving fields out (PATCH).
export function cleanDocumentInput(input, { partial = false } = {}) {
  const errors = [];
  const value = {};
  if (input.title !== undefined || !partial) {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title || title.length > 100) errors.push("title is required and must be at most 100 characters");
    else value.title = title;
  }
  if (input.category !== undefined || !partial) {
    if (!DOCUMENT_CATEGORIES.includes(input.category)) errors.push(`category must be one of: ${DOCUMENT_CATEGORIES.join(", ")}`);
    else value.category = input.category;
  }
  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null || input.expiresAt === "") value.expiresAt = null;
    else if (typeof input.expiresAt !== "string" || !validDay(input.expiresAt)) errors.push("expiresAt must be a real date like 2027-03-31");
    else value.expiresAt = input.expiresAt;
  }
  return { value, errors };
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// The expiry day itself is still valid. status: valid | expiring_soon | expired | no_expiry
export function documentExpiry(doc, now = new Date()) {
  if (!doc.expiresAt) return { status: "no_expiry", daysLeft: null };
  const today = todayUtc(now);
  const daysLeft = daysBetween(today, doc.expiresAt);
  if (daysLeft < 0) return { status: "expired", daysLeft };
  return { status: daysLeft <= EXPIRING_SOON_DAYS ? "expiring_soon" : "valid", daysLeft };
}

export const publicDocument = (doc, now = new Date()) => ({
  id: doc.id,
  candidateId: doc.candidateId,
  title: doc.title,
  category: doc.category,
  filename: doc.filename,
  type: doc.type,
  size: doc.size,
  expiresAt: doc.expiresAt,
  createdAt: doc.createdAt,
  ...documentExpiry(doc, now),
  isExpired: documentExpiry(doc, now).status === "expired"
});
