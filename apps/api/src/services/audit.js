import crypto from "node:crypto";
import { AuditLog } from "../models/AuditLog.js";
import { isDatabaseReady } from "./userStore.js";

const MEMORY_LIMIT = 5000;
const memoryAudit = [];

const clip = (value, max) => String(value ?? "").slice(0, max);

function toEntry(entry) {
  return {
    id: String(entry._id ?? entry.id),
    actorId: entry.actorId || null,
    actorEmail: entry.actorEmail || null,
    actorRole: entry.actorRole || null,
    companyId: entry.companyId || null,
    source: entry.source || "user",
    action: entry.action,
    entityType: entry.entityType || null,
    entityId: entry.entityId || null,
    summary: entry.summary,
    meta: entry.meta || {},
    createdAt: new Date(entry.createdAt).toISOString()
  };
}

// Records one audit entry. Never throws: an audit failure must not break the user's request.
// Callers must only pass field names, statuses and ids in `meta`, never secrets or message text.
export async function recordAudit({ actor = null, source = "user", action, entityType, entityId, summary, meta = {}, companyId }) {
  try {
    const entry = {
      actorId: actor?.id ? String(actor.id) : undefined,
      actorEmail: actor?.email,
      actorRole: actor?.accessRole,
      companyId: companyId ? String(companyId) : actor?.companyId ? String(actor.companyId) : undefined,
      source,
      action: clip(action, 80),
      entityType: entityType ? clip(entityType, 40) : undefined,
      entityId: entityId ? clip(entityId, 80) : undefined,
      summary: clip(summary, 300),
      meta,
      createdAt: new Date()
    };

    if (isDatabaseReady()) {
      await AuditLog.create(entry);
    } else {
      memoryAudit.unshift({ id: crypto.randomUUID(), ...entry });
      if (memoryAudit.length > MEMORY_LIMIT) memoryAudit.length = MEMORY_LIMIT;
    }
    return true;
  } catch (error) {
    console.warn(`Audit write failed: ${error?.name || "Error"}`);
    return false;
  }
}

export async function listAudit({ actorId, action, entityType, entityId, companyId, limit = 50, before } = {}) {
  const pageSize = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const beforeDate = before ? new Date(before) : null;
  const useBefore = beforeDate && !Number.isNaN(beforeDate.getTime());

  if (isDatabaseReady()) {
    const query = {};
    if (actorId) query.actorId = String(actorId);
    if (action) query.action = String(action);
    if (entityType) query.entityType = String(entityType);
    if (entityId) query.entityId = String(entityId);
    if (companyId) query.companyId = String(companyId);
    if (useBefore) query.createdAt = { $lt: beforeDate };
    const rows = await AuditLog.find(query).sort({ createdAt: -1 }).limit(pageSize).lean();
    return rows.map(toEntry);
  }

  return memoryAudit
    .filter(
      (entry) =>
        (!actorId || entry.actorId === String(actorId)) &&
        (!action || entry.action === String(action)) &&
        (!entityType || entry.entityType === String(entityType)) &&
        (!entityId || entry.entityId === String(entityId)) &&
        (!companyId || entry.companyId === String(companyId)) &&
        (!useBefore || new Date(entry.createdAt) < beforeDate)
    )
    .slice(0, pageSize)
    .map(toEntry);
}
