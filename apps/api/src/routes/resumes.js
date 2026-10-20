import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { can } from "@acmp/shared";
import { requirePermission } from "../middleware/requireAuth.js";
import { recordAudit } from "../services/audit.js";
import { findCompanyById } from "../services/companyStore.js";
import { readFile, removeFile, saveFile } from "../services/fileStorage.js";
import { createResume, deleteResume, findResumeByHash, findResumeById } from "../services/resumeStore.js";
import {
  MAX_RESUME_BYTES,
  RESUME_TYPES,
  enhanceWithAi,
  extractResumeText,
  parseResumeText
} from "../services/resumeParser.js";

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

const ERROR_STATUS = { UNSUPPORTED: 415, TOO_LONG: 422, BAD_FILE: 422, NO_TEXT: 422 };

// Display name only: strip paths and control characters, keep the extension honest.
function cleanFilename(raw, type) {
  let name = "resume";
  try {
    name = decodeURIComponent(String(raw || "resume"));
  } catch {
    /* keep the default */
  }
  name = name
    .replace(/[\\/]+/g, "_")
    .replace(/[\u0000-\u001F\u007F"<>|:*?]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s_]+/, "")
    .trim()
    .slice(0, 120);
  const extension = `.${RESUME_TYPES[type].extension}`;
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "resume";
  return `${base}${extension}`;
}

const publicResume = (resume) => ({
  id: resume.id,
  filename: resume.filename,
  type: resume.type,
  size: resume.size,
  candidateId: resume.candidateId,
  createdAt: resume.createdAt
});

// Resume upload, parsing and download. Mounted after requireAuth.
// `findCandidate({ email | id, companyId })` lets the router warn about duplicates without owning candidate storage.
export function createResumesRouter({ findCandidate = async () => null } = {}) {
  const router = express.Router();

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.UPLOAD_RATE_LIMIT) || 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many uploads, please try again later" }
  });

  const canAccess = (user, resume) =>
    can(user, "candidate:read") && (can(user, "company:manage") || (Boolean(user.companyId) && user.companyId === resume.companyId));

  // Raw upload: the request body is the file; the original name comes in the X-Filename header.
  // The file type is decided from the bytes, never from the name or Content-Type.
  router.post(
    "/resumes",
    requirePermission("resume:upload"),
    uploadLimiter,
    express.raw({ type: () => true, limit: MAX_RESUME_BYTES }),
    asyncRoute(async (req, res) => {
      let companyId = req.user.companyId;
      if (can(req.user, "company:manage")) {
        const company = await findCompanyById(typeof req.query.companyId === "string" ? req.query.companyId : "");
        if (!company) return res.status(400).json({ error: "Choose the company this resume belongs to (companyId)" });
        companyId = company.id;
      } else if (!companyId) {
        return res.status(403).json({ error: "You are not assigned to a company yet. Ask an admin to add you to one." });
      }

      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: "Send the resume file as the request body" });
      }

      let extracted;
      try {
        extracted = await extractResumeText(buffer);
      } catch (error) {
        return res.status(ERROR_STATUS[error.code] || 422).json({ error: error.message });
      }

      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

      // The same file already uploaded by this company: reuse it (and its parse) instead of storing and parsing again.
      const previous = await findResumeByHash(companyId, sha256);
      if (previous) {
        const owner = previous.candidateId ? await findCandidate({ id: previous.candidateId, companyId }) : null;
        return res.json({
          resume: publicResume(previous),
          profile: previous.parsed,
          confidence: previous.confidence,
          warnings: previous.warnings,
          source: previous.source,
          reused: true,
          alreadyAttachedTo: owner ? { id: owner.id, name: owner.name } : previous.candidateId ? { id: previous.candidateId, name: null } : null,
          existingCandidate: null
        });
      }

      const rules = parseResumeText(extracted.text);
      // AI only fills what the rules could not find, from a redacted copy (see resumeParser.js).
      const enhanced = await enhanceWithAi(extracted.text, rules);
      const warnings = [...rules.warnings];

      const storedName = await saveFile(buffer, RESUME_TYPES[extracted.type].extension);
      let resume;
      try {
        resume = await createResume({
          companyId,
          uploadedBy: req.user.id,
          filename: cleanFilename(req.get("x-filename"), extracted.type),
          type: extracted.type,
          size: buffer.length,
          sha256,
          storedName,
          parsed: enhanced.profile,
          confidence: enhanced.confidence,
          source: enhanced.source,
          warnings
        });
      } catch (error) {
        await removeFile(storedName);
        throw error;
      }

      const existing = enhanced.profile.email ? await findCandidate({ email: enhanced.profile.email, companyId }) : null;
      if (existing) warnings.push(`A candidate with this email already exists in your company: ${existing.name}.`);

      await recordAudit({
        actor: req.user,
        action: "resume.uploaded",
        entityType: "resume",
        entityId: resume.id,
        companyId,
        summary: `Uploaded a ${extracted.type.toUpperCase()} resume (${Math.round(buffer.length / 1024)} KB)`,
        meta: { type: extracted.type, size: buffer.length, source: enhanced.source }
      });

      res.status(201).json({
        resume: publicResume(resume),
        profile: enhanced.profile,
        confidence: enhanced.confidence,
        warnings,
        source: enhanced.source,
        reused: false,
        alreadyAttachedTo: null,
        existingCandidate: existing ? { id: existing.id, name: existing.name } : null
      });
    })
  );

  router.get(
    "/resumes/:id",
    requirePermission("candidate:read"),
    asyncRoute(async (req, res) => {
      const resume = await findResumeById(req.params.id);
      if (!resume || !canAccess(req.user, resume)) return res.status(404).json({ error: "Resume not found" });
      res.json({ resume: publicResume(resume), profile: resume.parsed, confidence: resume.confidence, warnings: resume.warnings, source: resume.source });
    })
  );

  // Always a download (never rendered in the browser), with a fixed content type.
  router.get(
    "/resumes/:id/file",
    requirePermission("candidate:read"),
    asyncRoute(async (req, res) => {
      const resume = await findResumeById(req.params.id);
      if (!resume || !canAccess(req.user, resume)) return res.status(404).json({ error: "Resume not found" });
      let buffer;
      try {
        buffer = await readFile(resume.storedName);
      } catch {
        return res.status(404).json({ error: "The file is no longer available" });
      }
      await recordAudit({
        actor: req.user,
        action: "resume.downloaded",
        entityType: "resume",
        entityId: resume.id,
        companyId: resume.companyId,
        summary: "Downloaded a resume",
        meta: { candidateId: resume.candidateId }
      });
      res.setHeader("Content-Type", RESUME_TYPES[resume.type].mime);
      res.setHeader("Content-Disposition", `attachment; filename="${resume.filename.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(resume.filename)}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buffer);
    })
  );

  // Only resumes that were not turned into a candidate can be discarded here; deleting a candidate removes its resume.
  router.delete(
    "/resumes/:id",
    requirePermission("resume:upload"),
    asyncRoute(async (req, res) => {
      const resume = await findResumeById(req.params.id);
      if (!resume || !canAccess(req.user, resume)) return res.status(404).json({ error: "Resume not found" });
      if (resume.candidateId) return res.status(409).json({ error: "This resume belongs to a candidate. Delete the candidate to remove it." });
      await deleteResume(resume.id);
      await removeFile(resume.storedName);
      await recordAudit({
        actor: req.user,
        action: "resume.deleted",
        entityType: "resume",
        entityId: resume.id,
        companyId: resume.companyId,
        summary: "Discarded an uploaded resume"
      });
      res.json({ success: true });
    })
  );

  return router;
}
