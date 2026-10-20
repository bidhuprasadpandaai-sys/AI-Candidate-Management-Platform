import mongoose from "mongoose";

// Append-only: the API exposes no update or delete for audit entries.
const auditSchema = new mongoose.Schema(
  {
    actorId: { type: String, index: true },
    actorEmail: { type: String },
    actorRole: { type: String },
    // The company the action belongs to (the entity's company, else the actor's)
    companyId: { type: String, index: true },
    // "user" for a person acting directly, "ai" when the assistant acted on their request, "system" otherwise
    source: { type: String, enum: ["user", "ai", "system"], default: "user" },
    action: { type: String, required: true, index: true },
    entityType: { type: String, index: true },
    entityId: { type: String, index: true },
    summary: { type: String, required: true },
    // Field names, statuses and ids only: never passwords, tokens, codes or message text
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { versionKey: false }
);

export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditSchema);
