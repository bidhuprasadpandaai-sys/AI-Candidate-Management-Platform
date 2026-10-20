import express from "express";
import crypto from "node:crypto";
import { CURRENCY_CODES, ROLES, can, effectiveRole } from "@acmp/shared";
import { requirePermission } from "../middleware/requireAuth.js";
import { listAudit, recordAudit } from "../services/audit.js";
import {
  createCompany,
  deleteCompany,
  findCompanyById,
  getCompanyLogo,
  listCompanies,
  updateCompany
} from "../services/companyStore.js";
import { MAX_LOGO_BYTES, cleanBranding, logoToDataUrl, toBranding } from "../services/branding.js";
import { MAX_FACILITIES, cleanFacility } from "../services/facilities.js";
import { listJobs } from "../services/jobStore.js";
import { findUserDocById, listUsers, saveUser } from "../services/userStore.js";

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

const toUserSummary = (user, companyNames = new Map()) => ({
  id: String(user._id ?? user.id),
  email: user.email,
  name: user.name,
  role: user.role || "",
  accessRole: effectiveRole(user),
  companyId: user.companyId ? String(user.companyId) : null,
  companyName: user.companyId ? companyNames.get(String(user.companyId)) || null : null,
  isActive: user.isActive !== false,
  isVerified: Boolean(user.isVerified),
  createdAt: user.createdAt || null
});

function cleanCompanyInput(body, { partial = false } = {}) {
  const errors = [];
  const value = {};
  if (body?.name !== undefined || !partial) {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) errors.push("name is required and must be at most 80 characters");
    else value.name = name;
  }
  if (body?.description !== undefined) {
    const description = typeof body.description === "string" ? body.description.trim() : null;
    if (description === null || description.length > 300) errors.push("description must be text of at most 300 characters");
    else value.description = description;
  }
  if (body?.currencies !== undefined) {
    const codes = Array.isArray(body.currencies) ? [...new Set(body.currencies.map((code) => String(code).trim().toUpperCase()))] : null;
    if (!codes || codes.length < 1 || codes.length > 10 || codes.some((code) => !CURRENCY_CODES.includes(code))) {
      errors.push(`currencies must be 1 to 10 of: ${CURRENCY_CODES.join(", ")}`);
    } else {
      value.currencies = codes;
    }
  }
  if (body?.facilities !== undefined) {
    const items = Array.isArray(body.facilities) ? body.facilities : null;
    if (!items || items.length > MAX_FACILITIES) {
      errors.push(`facilities must be a list of at most ${MAX_FACILITIES} facilities`);
    } else {
      const seen = new Set();
      const cleaned = [];
      for (const item of items) {
        const result = cleanFacility(item);
        if (result.error) {
          errors.push(result.error);
          break;
        }
        if (seen.has(result.value.name.toLowerCase())) {
          errors.push(`facility "${result.value.name}" is listed twice`);
          break;
        }
        seen.add(result.value.name.toLowerCase());
        cleaned.push(result.value);
      }
      if (cleaned.length === items.length) value.facilities = cleaned;
    }
  }
  if (body?.branding !== undefined) {
    const branding = cleanBranding(body.branding);
    if (branding.errors.length) errors.push(...branding.errors);
    else value.branding = branding.value;
  }
  return { value, errors };
}

const isDuplicate = (error) => error?.code === 11000;

// Users, companies and the audit log. Mounted after requireAuth.
// `candidates` lets this router count and adopt candidates without owning their storage.
export function createAdminRouter({
  countCandidatesByCompany = async () => new Map(),
  adoptUnassignedCandidates = async () => 0
} = {}) {
  const router = express.Router();

  const companyNameMap = async () => new Map((await listCompanies()).map((company) => [company.id, company.name]));

  // ── Users (admin only) ─────────────────────────────────────────────────────
  router.get(
    "/users",
    requirePermission("user:manage"),
    asyncRoute(async (_req, res) => {
      const names = await companyNameMap();
      res.json({ users: (await listUsers()).map((user) => toUserSummary(user, names)), roles: ROLES });
    })
  );

  router.patch(
    "/users/:id",
    requirePermission("user:manage"),
    asyncRoute(async (req, res) => {
      const target = await findUserDocById(req.params.id);
      if (!target) return res.status(404).json({ error: "User not found" });

      const names = await companyNameMap();
      const body = req.body || {};
      const before = toUserSummary(target, names);
      const changes = {};

      if (body.accessRole !== undefined) {
        if (!ROLES.includes(body.accessRole)) return res.status(400).json({ error: `accessRole must be one of: ${ROLES.join(", ")}` });
        changes.accessRole = body.accessRole;
      }
      if (body.isActive !== undefined) {
        if (typeof body.isActive !== "boolean") return res.status(400).json({ error: "isActive must be true or false" });
        changes.isActive = body.isActive;
      }
      if (body.companyId !== undefined) {
        if (body.companyId === null || body.companyId === "") {
          changes.companyId = null;
        } else if (typeof body.companyId !== "string" || !names.has(body.companyId)) {
          return res.status(400).json({ error: "Company not found" });
        } else {
          changes.companyId = body.companyId;
        }
      }
      if (Object.keys(changes).length === 0) return res.status(400).json({ error: "Nothing to update" });

      // Never leave the system without an active admin.
      const losesAdmin =
        before.accessRole === "admin" &&
        before.isActive &&
        ((changes.accessRole && changes.accessRole !== "admin") || changes.isActive === false);
      if (losesAdmin) {
        const activeAdmins = (await listUsers()).map((user) => toUserSummary(user, names)).filter((user) => user.accessRole === "admin" && user.isActive);
        if (activeAdmins.length <= 1) {
          return res.status(409).json({ error: "At least one active admin is required" });
        }
      }

      Object.assign(target, changes);
      if (changes.companyId === null) target.companyId = undefined;
      await saveUser(target);
      const after = toUserSummary(target, names);

      const changed = Object.keys(changes);
      await recordAudit({
        actor: req.user,
        action: changes.accessRole ? "user.role_changed" : changes.companyId !== undefined ? "user.company_changed" : "user.updated",
        entityType: "user",
        entityId: after.id,
        companyId: after.companyId || before.companyId,
        summary: `Updated ${after.email}: ${changed.join(", ")}`,
        meta: {
          changed,
          ...(changes.accessRole ? { accessRole: { from: before.accessRole, to: after.accessRole } } : {}),
          ...(changes.isActive !== undefined ? { isActive: { from: before.isActive, to: after.isActive } } : {}),
          ...(changes.companyId !== undefined ? { companyId: { from: before.companyId, to: after.companyId } } : {})
        }
      });
      res.json({ user: after });
    })
  );

  // ── Companies ──────────────────────────────────────────────────────────────
  // Admins see every company with counts; everyone else sees only their own company.
  router.get(
    "/companies",
    asyncRoute(async (req, res) => {
      const companies = await listCompanies();
      if (!can(req.user, "company:manage")) {
        return res.json({ companies: companies.filter((company) => company.id === req.user.companyId) });
      }
      const [users, counts] = await Promise.all([listUsers(), countCandidatesByCompany()]);
      res.json({
        companies: companies.map((company) => ({
          ...company,
          userCount: users.filter((user) => String(user.companyId || "") === company.id).length,
          candidateCount: counts.get(company.id) || 0
        })),
        unassignedCandidates: counts.get("") || 0
      });
    })
  );

  router.post(
    "/companies",
    requirePermission("company:manage"),
    asyncRoute(async (req, res) => {
      const { value, errors } = cleanCompanyInput(req.body);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      try {
        const company = await createCompany({ ...value, createdBy: req.user.id });
        await recordAudit({
          actor: req.user,
          action: "company.created",
          entityType: "company",
          entityId: company.id,
          companyId: company.id,
          summary: `Created company "${company.name}"`
        });
        res.status(201).json({ company });
      } catch (error) {
        if (isDuplicate(error)) return res.status(409).json({ error: "A company with this name already exists" });
        throw error;
      }
    })
  );

  router.patch(
    "/companies/:id",
    requirePermission("company:manage"),
    asyncRoute(async (req, res) => {
      const { value, errors } = cleanCompanyInput(req.body, { partial: true });
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      if (Object.keys(value).length === 0) return res.status(400).json({ error: "Nothing to update" });
      // A currency or facility that jobs still use cannot be removed from the company's lists.
      const current = await findCompanyById(req.params.id);
      if (!current) return res.status(404).json({ error: "Company not found" });
      if (value.currencies || value.facilities) {
        const jobs = await listJobs({ companyId: current.id });
        const droppedCurrencies = value.currencies ? current.currencies.filter((code) => !value.currencies.includes(code)) : [];
        const keptFacilityIds = value.facilities ? new Set(value.facilities.map((facility) => facility.id)) : null;
        const droppedFacilities = keptFacilityIds ? current.facilities.filter((facility) => !keptFacilityIds.has(facility.id)) : [];
        const usedCurrency = droppedCurrencies.find((code) => jobs.some((job) => job.currency === code));
        if (usedCurrency) return res.status(409).json({ error: `${usedCurrency} is used by existing jobs and cannot be removed` });
        const usedFacility = droppedFacilities.find((facility) => jobs.some((job) => job.facilityId === facility.id));
        if (usedFacility) return res.status(409).json({ error: `The facility "${usedFacility.name}" is used by existing jobs and cannot be removed` });
      }
      try {
        const company = await updateCompany(req.params.id, value);
        if (!company) return res.status(404).json({ error: "Company not found" });
        await recordAudit({
          actor: req.user,
          action: "company.updated",
          entityType: "company",
          entityId: company.id,
          companyId: company.id,
          summary: `Updated company "${company.name}"`,
          meta: { changed: Object.keys(value) }
        });
        res.json({ company });
      } catch (error) {
        if (isDuplicate(error)) return res.status(409).json({ error: "A company with this name already exists" });
        throw error;
      }
    })
  );

  // ── Facilities ────────────────────────────────────────────────────────────
  // Adding a work site is part of setting up jobs, so anyone who manages jobs can add one to THEIR company
  // (admins choose the company). Editing or removing sites stays with admins (company settings).
  router.post(
    "/companies/:id/facilities",
    requirePermission("job:manage"),
    asyncRoute(async (req, res) => {
      const company = await findCompanyById(req.params.id);
      if (!company || (!can(req.user, "company:manage") && company.id !== req.user.companyId)) {
        return res.status(404).json({ error: "Company not found" });
      }
      const { value, error } = cleanFacility({ ...req.body, id: undefined });
      if (error) return res.status(400).json({ error });
      if (company.facilities.length >= MAX_FACILITIES) return res.status(409).json({ error: `A company can have at most ${MAX_FACILITIES} facilities` });
      if (company.facilities.some((facility) => facility.name.toLowerCase() === value.name.toLowerCase())) {
        return res.status(409).json({ error: `This company already has a facility called "${value.name}"` });
      }
      const updated = await updateCompany(company.id, { facilities: [...company.facilities, value] });
      await recordAudit({
        actor: req.user,
        action: "company.updated",
        entityType: "company",
        entityId: company.id,
        companyId: company.id,
        summary: `Added a facility to "${company.name}"`,
        meta: { changed: ["facilities"] }
      });
      res.status(201).json({ facility: updated.facilities.find((facility) => facility.id === value.id), facilities: updated.facilities });
    })
  );

  // ── Branding (white label) ────────────────────────────────────────────────
  // One place for company name, details, colours and logo. Everyone gets their own company's branding;
  // admins can ask for any company with ?companyId=. No company means the platform default.
  router.get(
    "/branding",
    asyncRoute(async (req, res) => {
      const wanted = can(req.user, "company:manage") && typeof req.query.companyId === "string" ? req.query.companyId : req.user.companyId;
      const company = wanted ? await findCompanyById(wanted) : null;
      res.json({ branding: toBranding(company, company ? await getCompanyLogo(company.id) : null) });
    })
  );

  router.put(
    "/companies/:id/logo",
    requirePermission("company:manage"),
    express.raw({ type: () => true, limit: MAX_LOGO_BYTES }),
    asyncRoute(async (req, res) => {
      const current = await findCompanyById(req.params.id);
      if (!current) return res.status(404).json({ error: "Company not found" });
      let logo;
      try {
        logo = logoToDataUrl(req.body);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      const company = await updateCompany(current.id, { logo });
      await recordAudit({
        actor: req.user,
        action: "company.updated",
        entityType: "company",
        entityId: company.id,
        companyId: company.id,
        summary: `Changed the logo of "${company.name}"`,
        meta: { changed: ["logo"] }
      });
      res.json({ branding: toBranding(company, logo) });
    })
  );

  router.delete(
    "/companies/:id/logo",
    requirePermission("company:manage"),
    asyncRoute(async (req, res) => {
      const company = await updateCompany(req.params.id, { logo: "" });
      if (!company) return res.status(404).json({ error: "Company not found" });
      await recordAudit({
        actor: req.user,
        action: "company.updated",
        entityType: "company",
        entityId: company.id,
        companyId: company.id,
        summary: `Removed the logo of "${company.name}"`,
        meta: { changed: ["logo"] }
      });
      res.json({ branding: toBranding(company, null) });
    })
  );

  // A company with users or candidates cannot be deleted: move or remove them first, so data is never orphaned.
  router.delete(
    "/companies/:id",
    requirePermission("company:manage"),
    asyncRoute(async (req, res) => {
      const company = await findCompanyById(req.params.id);
      if (!company) return res.status(404).json({ error: "Company not found" });

      const [users, counts] = await Promise.all([listUsers(), countCandidatesByCompany()]);
      const userCount = users.filter((user) => String(user.companyId || "") === company.id).length;
      const candidateCount = counts.get(company.id) || 0;
      if (userCount > 0 || candidateCount > 0) {
        return res.status(409).json({
          error: `This company still has ${userCount} user(s) and ${candidateCount} candidate(s). Move or remove them first.`
        });
      }

      await deleteCompany(company.id);
      await recordAudit({
        actor: req.user,
        action: "company.deleted",
        entityType: "company",
        entityId: company.id,
        companyId: company.id,
        summary: `Deleted company "${company.name}"`
      });
      res.json({ success: true });
    })
  );

  // Moves every candidate that has no company into this one (used when adopting data that existed before companies).
  router.post(
    "/companies/:id/adopt-unassigned",
    requirePermission("company:manage"),
    asyncRoute(async (req, res) => {
      const company = await findCompanyById(req.params.id);
      if (!company) return res.status(404).json({ error: "Company not found" });
      const moved = await adoptUnassignedCandidates(company.id);
      await recordAudit({
        actor: req.user,
        action: "company.candidates_adopted",
        entityType: "company",
        entityId: company.id,
        companyId: company.id,
        summary: `Moved ${moved} candidate(s) without a company into "${company.name}"`,
        meta: { moved }
      });
      res.json({ moved });
    })
  );

  // ── Audit log (admin only, read-only) ───────────────────────────────────────
  router.get(
    "/audit",
    requirePermission("audit:read"),
    asyncRoute(async (req, res) => {
      const { actorId, action, entityType, entityId, companyId, limit, before } = req.query;
      // Query values must be plain strings (rejects ?actorId[$ne]=x style operator objects).
      if ([actorId, action, entityType, entityId, companyId, limit, before].some((value) => value !== undefined && typeof value !== "string")) {
        return res.status(400).json({ error: "Filters must be plain text values" });
      }
      const entries = await listAudit({ actorId, action, entityType, entityId, companyId, limit, before });
      res.json({ entries });
    })
  );

  return router;
}
