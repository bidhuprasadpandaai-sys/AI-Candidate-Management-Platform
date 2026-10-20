import express from "express";
import rateLimit from "express-rate-limit";
import { canEditCandidate, canViewCandidate, can } from "@acmp/shared";
import { requirePermission } from "../middleware/requireAuth.js";
import { recordAudit } from "../services/audit.js";
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENTS_PER_CANDIDATE,
  MAX_DOCUMENT_BYTES,
  cleanDocumentInput,
  detectDocumentType,
  publicDocument
} from "../services/documentRules.js";
import { createDocument, deleteDocument, findDocumentById, listDocumentsByCandidate, updateDocument } from "../services/documentStore.js";
import { readFile, removeFile, saveFile } from "../services/fileStorage.js";

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

// Display name only: strip paths and control characters, keep the extension honest.
function cleanFilename(raw, type) {
  let name = "document";
  try {
    name = decodeURIComponent(String(raw || "document"));
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
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "document";
  return `${base}.${DOCUMENT_TYPES[type].extension}`;
}

// Candidate documents (certificates, IDs, contracts ...) with optional expiry dates. Mounted after requireAuth.
// `findCandidate(id)` returns the candidate record so access follows the candidate's own rules.
export function createDocumentsRouter({ findCandidate }) {
  const router = express.Router();

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.UPLOAD_RATE_LIMIT) || 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many uploads, please try again later" }
  });

  // 404 when the candidate is not visible to the user (existence is not revealed), 403 when visible but not editable.
  async function loadCandidate(req, res, { write }) {
    const candidate = await findCandidate(req.params.id);
    if (!candidate || !canViewCandidate(req.user, candidate)) {
      res.status(404).json({ error: "Candidate not found" });
      return null;
    }
    if (write && !canEditCandidate(req.user, candidate)) {
      res.status(403).json({ error: "You do not have permission to change this candidate's documents" });
      return null;
    }
    return candidate;
  }

  async function loadDocument(req, res, { write }) {
    const doc = await findDocumentById(req.params.id);
    const candidate = doc ? await findCandidate(doc.candidateId) : null;
    if (!doc || !candidate || !canViewCandidate(req.user, candidate)) {
      res.status(404).json({ error: "Document not found" });
      return null;
    }
    if (write && !(can(req.user, "resume:upload") && canEditCandidate(req.user, candidate))) {
      res.status(403).json({ error: "You do not have permission to change this candidate's documents" });
      return null;
    }
    return { doc, candidate };
  }

  router.get(
    "/candidates/:id/documents",
    requirePermission("candidate:read"),
    asyncRoute(async (req, res) => {
      const candidate = await loadCandidate(req, res, { write: false });
      if (!candidate) return;
      const documents = await listDocumentsByCandidate(candidate.id);
      res.json({ documents: documents.map((doc) => publicDocument(doc)) });
    })
  );

  // Raw upload: the body is the file; details come from the query (title, category, expiresAt) and X-Filename.
  router.post(
    "/candidates/:id/documents",
    requirePermission("resume:upload"),
    uploadLimiter,
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    asyncRoute(async (req, res) => {
      const candidate = await loadCandidate(req, res, { write: true });
      if (!candidate) return;

      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) return res.status(400).json({ error: "Send the document as the request body" });
      const type = await detectDocumentType(buffer);
      if (!type) return res.status(415).json({ error: "The document must be a PDF, Word (.docx), PNG or JPEG file" });

      const input = { ...req.query };
      if (typeof input.title !== "string" || !input.title.trim()) input.title = cleanFilename(req.get("x-filename"), type).replace(/\.[^.]+$/, "");
      const { value, errors } = cleanDocumentInput(input);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });

      if ((await listDocumentsByCandidate(candidate.id)).length >= MAX_DOCUMENTS_PER_CANDIDATE) {
        return res.status(409).json({ error: `A candidate can have at most ${MAX_DOCUMENTS_PER_CANDIDATE} documents` });
      }

      const storedName = await saveFile(buffer, DOCUMENT_TYPES[type].extension);
      let doc;
      try {
        doc = await createDocument({
          companyId: candidate.companyId,
          candidateId: candidate.id,
          uploadedBy: req.user.id,
          ...value,
          expiresAt: value.expiresAt || null,
          filename: cleanFilename(req.get("x-filename"), type),
          type,
          size: buffer.length,
          storedName
        });
      } catch (error) {
        await removeFile(storedName);
        throw error;
      }
      await recordAudit({
        actor: req.user,
        action: "document.uploaded",
        entityType: "document",
        entityId: doc.id,
        companyId: candidate.companyId,
        summary: `Uploaded a ${type.toUpperCase()} document (${value.category}) for a candidate`,
        meta: { candidateId: candidate.id, category: value.category, type, size: buffer.length, hasExpiry: Boolean(value.expiresAt) }
      });
      res.status(201).json({ document: publicDocument(doc) });
    })
  );

  router.patch(
    "/documents/:id",
    requirePermission("resume:upload"),
    asyncRoute(async (req, res) => {
      const found = await loadDocument(req, res, { write: true });
      if (!found) return;
      const { value, errors } = cleanDocumentInput(req.body || {}, { partial: true });
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      if (Object.keys(value).length === 0) return res.status(400).json({ error: "Nothing to update" });
      const doc = await updateDocument(found.doc.id, value);
      await recordAudit({
        actor: req.user,
        action: "document.updated",
        entityType: "document",
        entityId: doc.id,
        companyId: doc.companyId,
        summary: "Updated a candidate document",
        meta: { candidateId: doc.candidateId, changed: Object.keys(value) }
      });
      res.json({ document: publicDocument(doc) });
    })
  );

  // Always a download (never rendered in the browser), with a fixed content type.
  router.get(
    "/documents/:id/file",
    requirePermission("candidate:read"),
    asyncRoute(async (req, res) => {
      const found = await loadDocument(req, res, { write: false });
      if (!found) return;
      let buffer;
      try {
        buffer = await readFile(found.doc.storedName);
      } catch {
        return res.status(404).json({ error: "The file is no longer available" });
      }
      await recordAudit({
        actor: req.user,
        action: "document.downloaded",
        entityType: "document",
        entityId: found.doc.id,
        companyId: found.doc.companyId,
        summary: "Downloaded a candidate document",
        meta: { candidateId: found.doc.candidateId }
      });
      res.setHeader("Content-Type", DOCUMENT_TYPES[found.doc.type].mime);
      res.setHeader("Content-Disposition", `attachment; filename="${found.doc.filename.replace(/[^\x20-\x7E]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(found.doc.filename)}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buffer);
    })
  );

  router.delete(
    "/documents/:id",
    requirePermission("resume:upload"),
    asyncRoute(async (req, res) => {
      const found = await loadDocument(req, res, { write: true });
      if (!found) return;
      await deleteDocument(found.doc.id);
      await removeFile(found.doc.storedName);
      await recordAudit({
        actor: req.user,
        action: "document.deleted",
        entityType: "document",
        entityId: found.doc.id,
        companyId: found.doc.companyId,
        summary: "Deleted a candidate document",
        meta: { candidateId: found.doc.candidateId }
      });
      res.json({ success: true });
    })
  );

  return router;
}
