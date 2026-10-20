import mongoose from "mongoose";

// A document kept with a candidate (certificate, ID, contract ...). The file is on disk under a random name.
// `expiresAt` is a calendar day (YYYY-MM-DD); the Expired state is worked out on read, never stored.
const documentSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    candidateId: { type: String, required: true, index: true },
    uploadedBy: { type: String },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, required: true },
    filename: { type: String, required: true, maxlength: 200 },
    type: { type: String, enum: ["pdf", "docx", "png", "jpg"], required: true },
    size: { type: Number, required: true },
    storedName: { type: String, required: true },
    expiresAt: { type: String, default: null }
  },
  { timestamps: true }
);

export const CandidateDocument = mongoose.models.CandidateDocument || mongoose.model("CandidateDocument", documentSchema);
