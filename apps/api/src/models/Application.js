import mongoose from "mongoose";
import { PIPELINE_STAGES } from "@acmp/shared";

// A candidate's application to one job. A candidate can apply to several jobs; each application has its
// own pipeline stage (shown on that job's board) and its own fit score (computed, never stored here).
const applicationSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    candidateId: { type: String, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    status: { type: String, enum: PIPELINE_STAGES, default: "screening" },
    stage: { type: String, default: "Screening stage" },
    createdBy: { type: String }
  },
  { timestamps: true }
);

applicationSchema.index({ candidateId: 1, jobId: 1 }, { unique: true });

export const Application = mongoose.models.Application || mongoose.model("Application", applicationSchema);
