import express from "express";
import { can } from "@acmp/shared";
import { requirePermission } from "../middleware/requireAuth.js";
import { recordAudit } from "../services/audit.js";
import { findCompanyById } from "../services/companyStore.js";
import { isExpired, isFull, todayUtc } from "../services/jobRules.js";
import { createJob, deleteJob, findJobById, listJobs, updateJob } from "../services/jobStore.js";
import { findUserById, listUsers } from "../services/userStore.js";
import { validateJobInput } from "../utils/jobValidation.js";

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

// Job openings. Mounted after requireAuth. A job belongs to one company; users only see their own
// company's jobs (admins see all), and jobs of other companies answer 404.
// `jobStats` returns Map(jobId -> { total, byStatus }) so this router does not own candidate storage.
export function createJobsRouter({ jobStats = async () => new Map(), onJobChanged = async () => {} } = {}) {
  const router = express.Router();

  const canSeeJob = (user, job) => can(user, "company:manage") || (Boolean(user.companyId) && user.companyId === job.companyId);

  const BILL_FIELDS = ["billRateMin", "billRateMax"];

  // Adds names and counts. Bill rates (what the client pays) are only shown to people who manage jobs.
  async function decorate(jobs, user) {
    const [users, companies, stats] = await Promise.all([listUsers(), Promise.all([...new Set(jobs.map((j) => j.companyId))].map(findCompanyById)), jobStats()]);
    const userNames = new Map(users.map((u) => [String(u._id ?? u.id), u.name || u.email]));
    const companyMap = new Map(companies.filter(Boolean).map((company) => [company.id, company]));
    const showBill = can(user, "job:manage");
    return jobs.map((job) => {
      const company = companyMap.get(job.companyId);
      const count = stats.get(job.id)?.total || 0;
      const view = {
        ...job,
        hiringManagerName: job.hiringManagerId ? userNames.get(job.hiringManagerId) || null : null,
        companyName: company?.name || null,
        facilityName: job.facilityId ? company?.facilities.find((facility) => facility.id === job.facilityId)?.name || null : null,
        facilityLocation: job.facilityId ? company?.facilities.find((facility) => facility.id === job.facilityId)?.location || null : null,
        candidateCount: count,
        statusCounts: stats.get(job.id)?.byStatus || {},
        isExpired: isExpired(job),
        isFull: isFull(job, count)
      };
      if (!showBill) for (const field of BILL_FIELDS) view[field] = null;
      return view;
    });
  }

  // Checks the parts of a job that depend on the company's own lists and on today's date.
  // `existing` is the saved job (for updates); `value` holds the submitted fields.
  async function checkCompanyRules(value, existing, companyId) {
    const company = await findCompanyById(companyId);
    if (!company) return "Company not found";
    const merged = { ...(existing || {}), ...value };

    if (value.currency && !company.currencies.includes(value.currency)) {
      return `Choose one of this company's currencies: ${company.currencies.join(", ")}`;
    }
    const hasRate = ["payRateMin", "payRateMax", "billRateMin", "billRateMax"].some((field) => typeof merged[field] === "number");
    if (hasRate && !merged.currency) value.currency = company.currencies[0];

    if (value.facilityId && !company.facilities.some((facility) => facility.id === value.facilityId)) {
      return "Choose one of this company's facilities";
    }
    if (value.expiresAt && value.expiresAt !== existing?.expiresAt && value.expiresAt < todayUtc()) {
      return "The expiry date cannot be in the past";
    }
    for (const kind of ["pay", "bill"]) {
      const min = merged[`${kind}RateMin`];
      const max = merged[`${kind}RateMax`];
      if (typeof min === "number" && typeof max === "number" && min > max) return `The ${kind} rate minimum cannot be higher than the maximum`;
    }
    return null;
  }

  // The hiring manager must be an active user of the job's company.
  async function checkHiringManager(hiringManagerId, companyId) {
    if (hiringManagerId === null || hiringManagerId === undefined) return null;
    const user = await findUserById(hiringManagerId);
    if (!user || user.isActive === false || String(user.companyId || "") !== String(companyId)) {
      return "The hiring manager must be an active user of the job's company";
    }
    return null;
  }

  router.get(
    "/jobs",
    requirePermission("job:read"),
    asyncRoute(async (req, res) => {
      const admin = can(req.user, "company:manage");
      if (!admin && !req.user.companyId) return res.json({ jobs: [] });
      const filterCompany = admin && typeof req.query.companyId === "string" ? req.query.companyId : undefined;
      const jobs = await listJobs({ companyId: admin ? filterCompany : req.user.companyId });
      res.json({ jobs: await decorate(jobs, req.user) });
    })
  );

  // People who can be named hiring manager: active users of the company (not read-only accounts).
  // Declared before /jobs/:id so "hiring-managers" is not read as an id.
  router.get(
    "/jobs/hiring-managers",
    requirePermission("job:manage"),
    asyncRoute(async (req, res) => {
      const admin = can(req.user, "company:manage");
      const companyId = admin ? (typeof req.query.companyId === "string" ? req.query.companyId : "") : req.user.companyId;
      if (!companyId) return res.json({ users: [] });
      const users = (await listUsers())
        .filter((user) => user.isActive !== false && String(user.companyId || "") === String(companyId) && (user.accessRole || "recruiter") !== "viewer")
        .map((user) => ({ id: String(user._id ?? user.id), name: user.name || user.email, accessRole: user.accessRole || "recruiter" }));
      res.json({ users });
    })
  );

  router.get(
    "/jobs/:id",
    requirePermission("job:read"),
    asyncRoute(async (req, res) => {
      const job = await findJobById(req.params.id);
      if (!job || !canSeeJob(req.user, job)) return res.status(404).json({ error: "Job not found" });
      res.json({ job: (await decorate([job], req.user))[0] });
    })
  );

  router.post(
    "/jobs",
    requirePermission("job:manage"),
    asyncRoute(async (req, res) => {
      const { value, errors } = validateJobInput(req.body);
      if (errors) return res.status(400).json({ error: errors[0], errors });

      let companyId = req.user.companyId;
      if (can(req.user, "company:manage")) {
        const company = await findCompanyById(req.body.companyId);
        if (!company) return res.status(400).json({ error: "Choose the company this job belongs to (companyId)" });
        companyId = company.id;
      } else if (!companyId) {
        return res.status(403).json({ error: "You are not assigned to a company yet. Ask an admin to add you to one." });
      }

      const managerError = await checkHiringManager(value.hiringManagerId, companyId);
      if (managerError) return res.status(400).json({ error: managerError });
      const ruleError = await checkCompanyRules(value, null, companyId);
      if (ruleError) return res.status(400).json({ error: ruleError });

      const fields = { ...value, companyId, createdBy: req.user.id };
      for (const key of Object.keys(fields)) if (fields[key] === null) delete fields[key];
      const job = await createJob(fields);
      await recordAudit({
        actor: req.user,
        action: "job.created",
        entityType: "job",
        entityId: job.id,
        companyId,
        summary: `Opened job "${job.title}"`,
        meta: { status: job.status }
      });
      res.status(201).json({ job: (await decorate([job], req.user))[0] });
    })
  );

  router.patch(
    "/jobs/:id",
    requirePermission("job:manage"),
    asyncRoute(async (req, res) => {
      const existing = await findJobById(req.params.id);
      if (!existing || !canSeeJob(req.user, existing)) return res.status(404).json({ error: "Job not found" });

      const { value, errors } = validateJobInput(req.body, { partial: true });
      if (errors) return res.status(400).json({ error: errors[0], errors });
      if (Object.keys(value).length === 0) return res.status(400).json({ error: "Nothing to update" });

      if (value.hiringManagerId) {
        const managerError = await checkHiringManager(value.hiringManagerId, existing.companyId);
        if (managerError) return res.status(400).json({ error: managerError });
      }

      const ruleError = await checkCompanyRules(value, existing, existing.companyId);
      if (ruleError) return res.status(400).json({ error: ruleError });

      const job = await updateJob(existing.id, value);
      // a new description, title or location changes how well candidates fit: refresh their scores
      if (value.title !== undefined || value.description !== undefined || value.location !== undefined) await onJobChanged(job.id);
      const changed = Object.keys(value);
      await recordAudit({
        actor: req.user,
        action: "job.updated",
        entityType: "job",
        entityId: job.id,
        companyId: job.companyId,
        summary: `Updated job "${job.title}": ${changed.join(", ")}`,
        meta: {
          changed,
          ...(existing.status !== job.status ? { status: { from: existing.status, to: job.status } } : {})
        }
      });
      res.json({ job: (await decorate([job], req.user))[0] });
    })
  );

  // A job with candidates cannot be deleted: close it instead, so nobody's pipeline history disappears.
  router.delete(
    "/jobs/:id",
    requirePermission("job:manage"),
    asyncRoute(async (req, res) => {
      const job = await findJobById(req.params.id);
      if (!job || !canSeeJob(req.user, job)) return res.status(404).json({ error: "Job not found" });
      const candidates = (await jobStats()).get(job.id)?.total || 0;
      if (candidates > 0) {
        return res.status(409).json({ error: `This job still has ${candidates} application(s). Close the job instead, or remove the applications first.` });
      }
      await deleteJob(job.id);
      await recordAudit({
        actor: req.user,
        action: "job.deleted",
        entityType: "job",
        entityId: job.id,
        companyId: job.companyId,
        summary: `Deleted job "${job.title}"`
      });
      res.json({ success: true });
    })
  );

  return router;
}
