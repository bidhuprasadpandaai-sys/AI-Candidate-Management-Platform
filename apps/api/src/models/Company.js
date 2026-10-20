import mongoose from "mongoose";

// A company (tenant). Recruiters, hiring managers and read-only users belong to exactly one company
// and only see that company's candidates. Admins are platform-level and see all companies.
const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { type: String },
    // Currencies this company's jobs can use (empty means USD only)
    currencies: [{ type: String }],
    // This company's work sites. Jobs pick one; every company has its own list.
    // White-label details shown across the app for this company's users
    branding: {
      displayName: { type: String, default: "", trim: true, maxlength: 80 },
      tagline: { type: String, default: "", trim: true, maxlength: 120 },
      website: { type: String, default: "", trim: true, maxlength: 200 },
      supportEmail: { type: String, default: "", trim: true, maxlength: 120 },
      phone: { type: String, default: "", trim: true, maxlength: 40 },
      address: { type: String, default: "", trim: true, maxlength: 200 },
      primaryColor: { type: String, default: "" },
      accentColor: { type: String, default: "" }
    },
    // Logo as a small data URL (validated PNG/JPEG/WebP, at most 256 KB); never listed with companies
    logo: { type: String, default: "", select: false },
    facilities: [
      {
        _id: false,
        id: { type: String, required: true },
        name: { type: String, required: true, trim: true, maxlength: 80 },
        location: { type: String, default: "", trim: true, maxlength: 80 },
        address: { type: String, default: "", trim: true, maxlength: 200 },
        pinCode: { type: String, default: "", trim: true, maxlength: 12 }
      }
    ]
  },
  { timestamps: true }
);

companySchema.index({ name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export const Company = mongoose.models.Company || mongoose.model("Company", companySchema);
