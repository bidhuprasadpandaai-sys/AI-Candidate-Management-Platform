import mongoose from "mongoose";
import { EMPLOYMENT_TYPES, JOB_STATUSES, RATE_UNITS } from "@acmp/shared";

// A job opening. Belongs to one company; candidates are linked through candidate.jobId.
const jobSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, default: "", trim: true, maxlength: 80 },
    location: { type: String, default: "", trim: true, maxlength: 120 },
    status: { type: String, enum: JOB_STATUSES, default: "open" },
    // An active user of the same company who decides on this job
    hiringManagerId: { type: String },
    description: { type: String, default: "", trim: true, maxlength: 5000 },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: "full_time" },
    // Rates are in `currency` (one of the company's preset currencies) per `rateUnit`
    currency: { type: String },
    rateUnit: { type: String, enum: RATE_UNITS, default: "hour" },
    payRateMin: { type: Number, min: 0 },
    payRateMax: { type: Number, min: 0 },
    billRateMin: { type: Number, min: 0 },
    billRateMax: { type: Number, min: 0 },
    // One of the company's facilities (by id)
    facilityId: { type: String },
    // YYYY-MM-DD: after this day the job takes no new applications
    expiresAt: { type: String },
    // The most candidates that may apply; empty means no limit
    maxApplications: { type: Number, min: 1 },
    createdBy: { type: String }
  },
  { timestamps: true }
);

export const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);
