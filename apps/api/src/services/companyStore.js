import crypto from "node:crypto";
import mongoose from "mongoose";
import { Company } from "../models/Company.js";
import { isDatabaseReady } from "./userStore.js";
import { DEFAULT_BRANDING } from "./branding.js";

const memoryCompanies = [];

const toCompany = (company) => ({
  id: String(company._id ?? company.id),
  name: company.name,
  description: company.description || "",
  createdBy: company.createdBy || null,
  currencies: company.currencies?.length ? [...company.currencies] : ["USD"],
  facilities: (company.facilities || []).map((facility) => ({
    id: String(facility.id),
    name: facility.name,
    location: facility.location || "",
    address: facility.address || "",
    pinCode: facility.pinCode || ""
  })),
  branding: { ...DEFAULT_BRANDING, ...Object.fromEntries(Object.entries(company.branding || {}).filter(([, value]) => value)) },
  hasLogo: Boolean(company.logo),
  createdAt: company.createdAt ? new Date(company.createdAt).toISOString() : null
});

const toCompanyOrNull = (company) => (company ? toCompany(company) : null);

export async function listCompanies() {
  if (isDatabaseReady()) {
    return (await Company.find({}).sort({ name: 1 }).lean()).map(toCompany);
  }
  return [...memoryCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(toCompany);
}

export async function findCompanyById(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    return mongoose.isValidObjectId(id) ? toCompanyOrNull(await Company.findById(id).lean()) : null;
  }
  return toCompanyOrNull(memoryCompanies.find((company) => company.id === String(id)));
}

export async function findCompanyByName(name) {
  const wanted = String(name).trim().toLowerCase();
  return (await listCompanies()).find((company) => company.name.toLowerCase() === wanted) || null;
}

export async function getCompanyLogo(id) {
  if (id === undefined || id === null || id === "") return null;
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    return (await Company.findById(id).select("+logo").lean())?.logo || null;
  }
  return memoryCompanies.find((company) => company.id === String(id))?.logo || null;
}

export async function createCompany({ name, description = "", createdBy, currencies = [], facilities = [] }) {
  if (isDatabaseReady()) {
    const company = await Company.create({ name, description, createdBy, currencies, facilities });
    return toCompany(company);
  }
  if (memoryCompanies.some((company) => company.name.toLowerCase() === name.toLowerCase())) {
    const error = new Error("duplicate");
    error.code = 11000;
    throw error;
  }
  const company = { id: crypto.randomUUID(), name, description, createdBy, currencies, facilities, createdAt: new Date() };
  memoryCompanies.push(company);
  return toCompany(company);
}

export async function updateCompany(id, { name, description, currencies, facilities, branding, logo }) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return null;
    const update = {};
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (currencies !== undefined) update.currencies = currencies;
    if (facilities !== undefined) update.facilities = facilities;
    if (logo !== undefined) update.logo = logo || "";
    if (branding !== undefined) for (const [key, value] of Object.entries(branding)) update[`branding.${key}`] = value;
    return toCompanyOrNull(await Company.findByIdAndUpdate(id, update, { new: true, runValidators: true }).lean());
  }
  const company = memoryCompanies.find((item) => item.id === String(id));
  if (!company) return null;
  if (name !== undefined) {
    if (memoryCompanies.some((item) => item.id !== company.id && item.name.toLowerCase() === name.toLowerCase())) {
      const error = new Error("duplicate");
      error.code = 11000;
      throw error;
    }
    company.name = name;
  }
  if (description !== undefined) company.description = description;
  if (currencies !== undefined) company.currencies = currencies;
  if (facilities !== undefined) company.facilities = facilities;
  if (logo !== undefined) company.logo = logo || "";
  if (branding !== undefined) company.branding = { ...(company.branding || {}), ...branding };
  return toCompany(company);
}

export async function deleteCompany(id) {
  if (isDatabaseReady()) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Company.findByIdAndDelete(id));
  }
  const index = memoryCompanies.findIndex((company) => company.id === String(id));
  if (index === -1) return false;
  memoryCompanies.splice(index, 1);
  return true;
}
