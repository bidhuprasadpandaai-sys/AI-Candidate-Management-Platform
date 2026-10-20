import mongoose from "mongoose";

const candidateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    role: { type: String, required: true },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: ["screening", "interview", "offer", "hired", "rejected"],
      default: "screening"
    },
    score: { type: Number, min: 0, max: 100, default: 0 },
    stage: { type: String, default: "New application" },
    location: { type: String, default: "Remote" },
    experienceYears: { type: Number, default: 0 },
    skills: [{ type: String }],
    summary: { type: String, default: "" },
    ownerId: { type: String, index: true },
    resumeId: { type: String },
    companyId: { type: String, index: true },
    notes: [
      {
        author: { type: String, default: "Recruiter" },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    interviews: [
      {
        title: { type: String, required: true },
        date: { type: String, required: true },
        time: { type: String, required: true },
        interviewer: { type: String, required: true },
        type: { type: String, required: true }
      }
    ]
  },
  {
    timestamps: true
  }
);

// A candidate email is unique within a company (the same person can be a candidate at two companies).
candidateSchema.index({ companyId: 1, email: 1 }, { unique: true });

export const Candidate =
  mongoose.models.Candidate || mongoose.model("Candidate", candidateSchema);
