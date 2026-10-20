import mongoose from "mongoose";

// Metadata and the parsed draft of an uploaded resume. The file itself is on disk under a random name;
// the raw extracted text is never stored.
const resumeSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    uploadedBy: { type: String },
    filename: { type: String, required: true, maxlength: 200 },
    type: { type: String, enum: ["pdf", "docx"], required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true, index: true },
    storedName: { type: String, required: true },
    parsed: { type: mongoose.Schema.Types.Mixed, default: {} },
    confidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, enum: ["rules", "rules+ai"], default: "rules" },
    warnings: [{ type: String }],
    candidateId: { type: String, index: true }
  },
  { timestamps: true }
);

export const Resume = mongoose.models.Resume || mongoose.model("Resume", resumeSchema);
