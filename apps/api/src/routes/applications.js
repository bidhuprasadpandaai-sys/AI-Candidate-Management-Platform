import express from "express";
import { PIPELINE_STAGES, can, canEditCandidate, canViewCandidate } from "@acmp/shared";
import { requirePermission } from "../middleware/requireAuth.js";
import {
  createApplication,
  deleteApplication,
  findApplicationById,
  listApplicationsByCandidate,
  listApplicationsByJob,
  updateApplicationStatus
} from "../services/applicationStore.js";
import { recordAudit } from "../services/audit.js";
import { computeFit, explainFit } from "../services/fitScore.js";
import { applyBlockReason } from "../services/jobRules.js";
import { findJobById } from "../services/jobStore.js";

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

const brief = (fit) => ({ score: fit.score, level: fit.level, label: fit.label });

// A candidate can apply to several jobs. Each application has its own stage and its own fit score
// (profile + resume + that job's description). Mounted after requireAuth.
// Dependencies come from index.js so this router owns no candidate storage:
//   findCandidate(id) -> mapped candidate | null, decorate(candidate), resumeFor(candidate), refreshCandidate(id)
export function createApplicationsRouter({ findCandidate, decorate, resumeFor, refreshCandidate }) {
  const router = express.Router();

  const jobVisible = (user, job) => can(user, "company:manage") || (Boolean(user.companyId) && user.companyId === job.companyId);

  // The board for one job: its applications with the candidate card data and the fit for this job.
  router.get(
    "/jobs/:id/applications",
    requirePermission("job:read"),
    asyncRoute(async (req, res) => {
      const job = await findJobById(req.params.id);
      if (!job || !jobVisible(req.user, job)) return res.status(404).json({ error: "Job not found" });

      const rows = [];
      for (const application of await listApplicationsByJob(job.id)) {
        const candidate = await findCandidate(application.candidateId);
        if (!candidate || !canViewCandidate(req.user, candidate)) continue;
        const fit = computeFit({ candidate, resume: await resumeFor(candidate), job });
        rows.push({
          id: application.id,
          status: application.status,
          stage: application.stage,
          candidate: await decorate(candidate),
          fit: brief(fit)
        });
      }
      rows.sort((a, b) => b.fit.score - a.fit.score);
      res.json({ job: { id: job.id, title: job.title, status: job.status }, applications: rows });
    })
  );

  // All of a candidate's applications with the full fit breakdown for each job.
  router.get(
    "/candidates/:id/applications",
    requirePermission("candidate:read"),
    asyncRoute(async (req, res) => {
      const candidate = await findCandidate(req.params.id);
      if (!candidate || !canViewCandidate(req.user, candidate)) return res.status(404).json({ error: "Candidate not found" });

      const resume = await resumeFor(candidate);
      const rows = [];
      for (const application of await listApplicationsByCandidate(candidate.id)) {
        const job = await findJobById(application.jobId);
        if (!job || String(job.companyId) !== String(candidate.companyId)) continue;
        const fit = computeFit({ candidate, resume, job });
        const ai = await explainFit(fit, job);
        rows.push({
          id: application.id,
          status: application.status,
          stage: application.stage,
          job: { id: job.id, title: job.title, status: job.status },
          fit: { ...fit, explanation: ai ? ai.text : fit.explanation, explanationSource: ai ? "ai" : "rules" }
        });
      }
      rows.sort((a, b) => b.fit.score - a.fit.score);
      res.json({ applications: rows });
    })
  );

  // Apply the candidate to a job of their own company.
  router.post(
    "/candidates/:id/applications",
    requirePermission("candidate:update"),
    asyncRoute(async (req, res) => {
      const candidate = await findCandidate(req.params.id);
      if (!candidate || !canViewCandidate(req.user, candidate)) return res.status(404).json({ error: "Candidate not found" });
      if (!canEditCandidate(req.user, candidate)) return res.status(403).json({ error: "You do not have permission to do this" });

      const job = typeof req.body?.jobId === "string" ? await findJobById(req.body.jobId) : null;
      if (!job || String(job.companyId) !== String(candidate.companyId)) return res.status(400).json({ error: "Job not found in this company" });
      const blocked = applyBlockReason(job, (await listApplicationsByJob(job.id)).length);
      if (blocked) return res.status(400).json({ error: blocked });

      let application;
      try {
        application = await createApplication({ companyId: candidate.companyId, candidateId: candidate.id, jobId: job.id, createdBy: req.user.id });
      } catch (error) {
        if (error?.code === 11000) return res.status(409).json({ error: "This candidate has already applied to this job" });
        throw error;
      }
      await refreshCandidate(candidate.id);
      await recordAudit({
        actor: req.user,
        action: "application.created",
        entityType: "candidate",
        entityId: candidate.id,
        companyId: candidate.companyId,
        summary: `Added ${candidate.name} to the job "${job.title}"`,
        meta: { applicationId: application.id, jobId: job.id }
      });
      res.status(201).json({ application });
    })
  );

  // Move an application to another pipeline stage (the board's drag and drop).
  router.patch(
    "/applications/:id",
    requirePermission("candidate:update"),
    asyncRoute(async (req, res) => {
      const application = await findApplicationById(req.params.id);
      const candidate = application ? await findCandidate(application.candidateId) : null;
      if (!application || !candidate || !canViewCandidate(req.user, candidate)) return res.status(404).json({ error: "Application not found" });
      if (!canEditCandidate(req.user, candidate)) return res.status(403).json({ error: "You do not have permission to do this" });

      const status = req.body?.status;
      if (!PIPELINE_STAGES.includes(status)) return res.status(400).json({ error: `status must be one of: ${PIPELINE_STAGES.join(", ")}` });

      const updated = await updateApplicationStatus(application.id, status);
      await refreshCandidate(candidate.id);
      const job = await findJobById(application.jobId);
      await recordAudit({
        actor: req.user,
        action: "application.moved",
        entityType: "candidate",
        entityId: candidate.id,
        companyId: candidate.companyId,
        summary: `Moved ${candidate.name} to ${status} for "${job?.title || "a job"}"`,
        meta: { applicationId: application.id, jobId: application.jobId, status: { from: application.status, to: status } }
      });
      res.json({ application: updated });
    })
  );

  router.delete(
    "/applications/:id",
    requirePermission("candidate:update"),
    asyncRoute(async (req, res) => {
      const application = await findApplicationById(req.params.id);
      const candidate = application ? await findCandidate(application.candidateId) : null;
      if (!application || !candidate || !canViewCandidate(req.user, candidate)) return res.status(404).json({ error: "Application not found" });
      if (!canEditCandidate(req.user, candidate)) return res.status(403).json({ error: "You do not have permission to do this" });

      await deleteApplication(application.id);
      await refreshCandidate(candidate.id);
      const job = await findJobById(application.jobId);
      await recordAudit({
        actor: req.user,
        action: "application.removed",
        entityType: "candidate",
        entityId: candidate.id,
        companyId: candidate.companyId,
        summary: `Removed ${candidate.name} from the job "${job?.title || "a job"}"`,
        meta: { applicationId: application.id, jobId: application.jobId }
      });
      res.json({ success: true });
    })
  );

  return router;
}
