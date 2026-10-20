import "./config/env.js";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  buildDashboardMetrics,
  can,
  canAnnotateCandidate,
  canAssignCandidate,
  canDeleteCandidate,
  canEditCandidate,
  canViewCandidate,
  effectiveRole,
  generateAiReply,
  parseAiMessage,
  visibleCandidates
} from "@acmp/shared";
import { connectDB } from "./config/db.js";
import { seedCandidates } from "./data/seedCandidates.js";
import mongoose from "mongoose";
import { Candidate } from "./models/Candidate.js";
import { Conversation } from "./models/Conversation.js";
import { Message } from "./models/Message.js";
import { requireAuth, requirePermission } from "./middleware/requireAuth.js";
import { createAdminRouter } from "./routes/admin.js";
import { createApplicationsRouter } from "./routes/applications.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createResumesRouter } from "./routes/resumes.js";
import { deleteDocumentsByCandidate } from "./services/documentStore.js";
import authRouter from "./routes/auth.js";
import { listAudit, recordAudit } from "./services/audit.js";
import {
  applicationStatsByJob,
  createApplication,
  deleteApplicationsByCandidate,
  listApplicationsByCandidate,
  listApplicationsByJob,
  listApplicationsByCandidates,
  stageLabel,
  updateApplicationStatus
} from "./services/applicationStore.js";
import { computeFit } from "./services/fitScore.js";
import { applyBlockReason } from "./services/jobRules.js";
import { removeFile } from "./services/fileStorage.js";
import { findJobById, listJobs } from "./services/jobStore.js";
import { deleteResume, findResumeById, setResumeCandidate } from "./services/resumeStore.js";
import { generateLlmReply } from "./services/llm.js";
import { createCompany, findCompanyById, findCompanyByName, listCompanies } from "./services/companyStore.js";
import { migrateJobLinksToApplications, migrateTeamsToCompanies } from "./services/migrations.js";
import { findUserById, listUsers } from "./services/userStore.js";
import { validateCandidateInput } from "./utils/candidateValidation.js";
import { assertEmailConfig } from "./utils/email.js";
import { assertJwtSecret } from "./utils/jwt.js";

assertJwtSecret();
assertEmailConfig();

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && !process.env.CLIENT_URL) {
  throw new Error("CLIENT_URL must be set in production (it is the only allowed CORS origin)");
}
const devOrigins = [
  "http://localhost:4410",
  "http://127.0.0.1:4410",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];
const allowedOrigins = [
  process.env.CLIENT_URL,
  ...(isProduction ? [] : devOrigins)
].filter(Boolean);
const moduleManifest = [
  {
    id: "overview",
    name: "Overview",
    description: "Shell dashboard and platform health",
    route: "/overview",
    remote: false
  },
  {
    id: "candidates",
    name: "Candidates",
    description: "Pipeline and search experience",
    route: "/candidates",
    remote: false
  },
  {
    id: "chat",
    name: "Chat",
    description: "Candidate conversations workspace",
    route: "/chat",
    remote: false
  },
  {
    id: "assistant",
    name: "AI Assistant",
    description: "Recruiting copilot workspace",
    route: "/assistant",
    remote: false
  },
  {
    id: "jobs",
    name: "Jobs",
    description: "Openings and pipeline boards",
    route: "/jobs",
    remote: false
  },
  {
    id: "analytics",
    name: "Analytics",
    description: "Delivery and adoption insights",
    route: "/analytics",
    remote: false
  },
  {
    id: "admin",
    name: "Admin",
    description: "Users, companies and audit log",
    route: "/admin",
    remote: false,
    requires: "user:manage"
  }
];

const rateLimitResponse = { error: "Too many requests, please try again later" };
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT) || 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateLimitResponse
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: rateLimitResponse
});

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    // lets the browser read the file name of a resume download
    exposedHeaders: ["Content-Disposition"]
  })
);
app.use(express.json());
app.use("/api", apiLimiter);
// Brute-force protection for credential endpoints (not /me or /logout).
app.use(
  [
    "/api/auth/signup",
    "/api/auth/signin",
    "/api/auth/otp/request",
    "/api/auth/otp/verify",
    "/api/auth/request-reset",
    "/api/auth/reset",
    "/api/auth/reset-password",
    "/api/auth/change-password"
  ],
  authLimiter
);
app.use("/api/auth", authRouter);

const usingDatabase = await connectDB();
if (usingDatabase) {
  const linked = await migrateJobLinksToApplications();
  if (linked.applications > 0) console.log(`Converted ${linked.applications} job link(s) to applications.`);
  const migrated = await migrateTeamsToCompanies();
  if (migrated.teams > 0) {
    console.log(`Migrated ${migrated.teams} team(s) to companies (${migrated.users} user(s), ${migrated.candidates} candidate(s)).`);
  }
}

const DEMO_COMPANY_NAME = "Demo Company";
async function ensureDemoCompany() {
  return (await findCompanyByName(DEMO_COMPANY_NAME)) || (await createCompany({ name: DEMO_COMPANY_NAME, description: "Sample data for trying the app" }));
}
// Without MongoDB the app starts with demo candidates in a demo company.
const memoryDemoCompany = usingDatabase ? null : await ensureDemoCompany();
let memoryCandidates = seedCandidates.map((candidate, index) => ({
  id: `demo-${index + 1}`,
  ...(memoryDemoCompany ? { companyId: memoryDemoCompany.id } : {}),
  ...candidate
}));
let memoryConversations = [];
let memoryMessages = [];

const mapCandidate = (candidate) => ({
  id: String(candidate._id || candidate.id || candidate.email),
  name: candidate.name,
  email: candidate.email,
  phone: candidate.phone || "",
  role: candidate.role,
  status: candidate.status,
  score: Number(candidate.score || 0),
  stage: candidate.stage || "New application",
  location: candidate.location || "Remote",
  experienceYears: Number(candidate.experienceYears || 0),
  skills: candidate.skills || [],
  summary: candidate.summary || "",
  notes: candidate.notes || [],
  interviews: candidate.interviews || [],
  ownerId: candidate.ownerId ? String(candidate.ownerId) : null,
  companyId: candidate.companyId ? String(candidate.companyId) : null,
  resumeId: candidate.resumeId ? String(candidate.resumeId) : null
});

const mapConversation = (conversation) => ({
  id: String(conversation._id || conversation.id),
  type: conversation.type || "individual",
  candidateIds: Array.isArray(conversation.candidateIds) ? conversation.candidateIds.map(String) : [],
  title: conversation.title || "Untitled conversation",
  ownerId: conversation.ownerId ? String(conversation.ownerId) : null,
  companyId: conversation.companyId ? String(conversation.companyId) : null,
  createdAt: conversation.createdAt || null,
  updatedAt: conversation.updatedAt || conversation.createdAt || null
});

const mapMessage = (message) => ({
  id: String(message._id || message.id),
  conversationId: String(message.conversationId),
  sender: message.sender,
  senderName: message.senderName,
  text: message.text,
  attachments: Array.isArray(message.attachments) ? message.attachments : [],
  createdAt: message.createdAt || null
});

const asyncHandler = (handler) => async (request, response, next) => {
  try {
    await handler(request, response, next);
  } catch (error) {
    next(error);
  }
};

async function fetchCandidates({ search = "", status = "all" } = {}) {
  if (!usingDatabase) {
    return memoryCandidates
      .filter((candidate) => {
        const matchesSearch =
          !search ||
          [candidate.name, candidate.role, ...(candidate.skills || [])]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase());
        const matchesStatus = status === "all" || candidate.status === status;
        return matchesSearch && matchesStatus;
      })
      .map(mapCandidate);
  }

  const query = {};

  if (status !== "all") {
    query.status = status;
  }

  if (search) {
    // Escape the user's text so it is matched literally (no regex injection or ReDoS).
    const pattern = new RegExp(escapeRegex(String(search).slice(0, 100)), "i");
    query.$or = [{ name: pattern }, { role: pattern }, { skills: { $in: [pattern] } }];
  }

  const candidates = await Candidate.find(query)
    .sort({ score: -1, createdAt: -1 })
    .lean();
  return candidates.map(mapCandidate);
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Candidates the signed-in user is allowed to see.
async function fetchVisibleCandidates(user, filters) {
  return visibleCandidates(user, await fetchCandidates(filters));
}

async function getCandidateDirectory(user) {
  const candidates = await fetchVisibleCandidates(user);
  return new Map(candidates.map((candidate) => [candidate.id, candidate]));
}

// Adds owner and company names for display.
async function withOwnership(candidates) {
  const [users, companies] = await Promise.all([listUsers(), listCompanies()]);
  const userNames = new Map(users.map((user) => [String(user._id ?? user.id), user.name]));
  const companyNames = new Map(companies.map((company) => [company.id, company.name]));
  const decorate = (candidate) => ({
    ...candidate,
    ownerName: candidate.ownerId ? userNames.get(candidate.ownerId) || null : null,
    companyName: candidate.companyId ? companyNames.get(candidate.companyId) || null : null
  });
  return Array.isArray(candidates) ? candidates.map(decorate) : decorate(candidates);
}

// candidate counts per company id ("" = candidates without a company)
async function countCandidatesByCompany() {
  const counts = new Map();
  const all = usingDatabase
    ? (await Candidate.find({}, { companyId: 1 }).lean()).map((c) => c.companyId)
    : memoryCandidates.map((c) => c.companyId);
  for (const companyId of all) {
    const key = companyId ? String(companyId) : "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// A candidate of a company by email or id (for duplicate warnings on resume upload).
async function findCandidate({ email, id, companyId }) {
  const all = await fetchCandidates();
  const sameCompany = (candidate) => String(candidate.companyId || "") === String(companyId || "");
  if (id) return all.find((candidate) => candidate.id === String(id) && sameCompany(candidate)) || null;
  if (email) return all.find((candidate) => candidate.email?.toLowerCase() === String(email).toLowerCase() && sameCompany(candidate)) || null;
  return null;
}

// A resume can be attached to a candidate of the same company if it is not used by another candidate.
async function resolveResumeFor(resumeId, companyId, candidateId = null) {
  const resume = typeof resumeId === "string" ? await findResumeById(resumeId) : null;
  if (!resume || String(resume.companyId) !== String(companyId)) return { error: "Resume not found in this company" };
  if (resume.candidateId && resume.candidateId !== String(candidateId)) return { error: "This resume is already attached to another candidate" };
  return { value: resume };
}

async function discardResume(resumeId) {
  const resume = resumeId ? await findResumeById(resumeId) : null;
  if (!resume) return;
  await deleteResume(resume.id);
  await removeFile(resume.storedName);
}

// A candidate's resume draft (parsed skills, years, role), if they have one in their own company.
async function resumeFor(candidate) {
  const resume = candidate.resumeId ? await findResumeById(candidate.resumeId) : null;
  return resume && String(resume.companyId) === String(candidate.companyId) ? resume : null;
}

const STAGE_RANK = { rejected: 0, screening: 1, interview: 2, offer: 3, hired: 4 };

// Keeps the candidate's own fields in step with their applications:
//  - status/stage: the furthest stage they have reached in any job (rejected only when rejected everywhere)
//  - score: their best job fit (0 until they apply to a job)
// Called whenever applications, the candidate's profile or a job description change.
async function refreshCandidate(candidateId) {
  const candidate = await findCandidateRecord(candidateId);
  if (!candidate) return;
  const applications = await listApplicationsByCandidate(candidate.id);
  if (!applications.length) return;

  const active = applications.filter((application) => application.status !== "rejected");
  const status = active.length ? active.reduce((best, a) => (STAGE_RANK[a.status] > STAGE_RANK[best] ? a.status : best), active[0].status) : "rejected";

  const resume = await resumeFor(candidate);
  let best = 0;
  for (const application of applications) {
    const job = await findJobById(application.jobId);
    if (job && String(job.companyId) === String(candidate.companyId)) best = Math.max(best, computeFit({ candidate, resume, job }).score);
  }
  await setCandidateFields(candidate.id, { status, stage: stageLabel(status), score: best });
}

// After a job's description changes, every candidate who applied gets their best-fit score updated.
async function refreshJobCandidates(jobId) {
  for (const application of await listApplicationsByJob(jobId)) await refreshCandidate(application.candidateId);
}

// Adds each candidate's applications with the fit score for each job (for the table and cards).
async function withApplications(candidates) {
  if (!candidates.length) return candidates;
  const [byCandidate, jobs] = await Promise.all([listApplicationsByCandidates(candidates.map((c) => c.id)), listJobs()]);
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const result = [];
  for (const candidate of candidates) {
    const applications = [];
    const mine = byCandidate.get(candidate.id) || [];
    const resume = mine.length ? await resumeFor(candidate) : null;
    for (const application of mine) {
      const job = jobMap.get(application.jobId);
      if (!job || String(job.companyId) !== String(candidate.companyId)) continue;
      const fit = computeFit({ candidate, resume, job });
      applications.push({ id: application.id, jobId: job.id, jobTitle: job.title, status: application.status, score: fit.score, level: fit.level });
    }
    applications.sort((a, b) => b.score - a.score);
    result.push({ ...candidate, applications });
  }
  return result;
}

async function adoptUnassignedCandidates(companyId) {
  if (!usingDatabase) {
    let moved = 0;
    memoryCandidates = memoryCandidates.map((candidate) => {
      if (candidate.companyId) return candidate;
      moved += 1;
      return { ...candidate, companyId };
    });
    return moved;
  }
  const result = await Candidate.updateMany(
    { $or: [{ companyId: { $exists: false } }, { companyId: null }, { companyId: "" }] },
    { $set: { companyId } }
  );
  return result.modifiedCount;
}

// One candidate by id (or email, as before), mapped; null when missing.
async function findCandidateRecord(id) {
  if (!usingDatabase) {
    const candidate = memoryCandidates.find((item) => item.id === id);
    return candidate ? mapCandidate(candidate) : null;
  }
  const candidate = mongoose.isValidObjectId(id)
    ? await Candidate.findById(id).lean()
    : await Candidate.findOne({ email: String(id).toLowerCase() }).lean();
  return candidate ? mapCandidate(candidate) : null;
}

async function setCandidateFields(id, fields) {
  if (!usingDatabase) {
    const index = memoryCandidates.findIndex((item) => item.id === id);
    if (index === -1) return null;
    memoryCandidates[index] = { ...memoryCandidates[index], ...fields };
    return mapCandidate(memoryCandidates[index]);
  }
  const updated = await Candidate.findByIdAndUpdate(id, fields, { new: true, runValidators: true }).lean();
  return updated ? mapCandidate(updated) : null;
}

function generateCandidateReply(candidateName = "Candidate", recruiterText = "") {
  const firstName = candidateName.trim().split(/\s+/)[0] || "Candidate";
  const text = recruiterText.trim().toLowerCase();

  if (text.includes("interview")) {
    return `Hi, this is ${firstName}. Thanks for the update. I am available and happy to coordinate the interview details.`;
  }

  if (text.includes("offer")) {
    return `Thank you for sharing this. I appreciate the opportunity and will review the offer details carefully.`;
  }

  if (text.includes("portfolio") || text.includes("resume")) {
    return `Thanks for reaching out. I can send over any additional materials you need and answer follow-up questions.`;
  }

  return `Hi, this is ${firstName}. Thanks for the update. I appreciate the message and will follow up soon.`;
}

async function fetchConversationById(conversationId) {
  if (!usingDatabase) {
    const conversation = memoryConversations.find((item) => item.id === conversationId);
    return conversation ? mapConversation(conversation) : null;
  }

  const conversation = await Conversation.findById(conversationId).lean();
  return conversation ? mapConversation(conversation) : null;
}

async function fetchConversationMessages(conversationId) {
  if (!usingDatabase) {
    return memoryMessages
      .filter((message) => message.conversationId === conversationId)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      .map(mapMessage);
  }

  const messages = await Message.find({ conversationId })
    .sort({ createdAt: 1 })
    .lean();
  return messages.map(mapMessage);
}

// Conversations belong to a company: its chat users see them; admins see all. Legacy
// conversations without a company are visible to admins only.
function canSeeConversationFor(user, conversation) {
  if (can(user, "company:manage")) return true;
  return Boolean(user.companyId) && String(conversation.companyId || "") === user.companyId;
}

async function fetchConversationSummaries(user) {
  const candidateDirectory = await getCandidateDirectory(user);
  const canSeeConversation = (conversation) => canSeeConversationFor(user, conversation);

  if (!usingDatabase) {
    return memoryConversations
      .filter(canSeeConversation)
      .map((conversation) => {
        const mappedConversation = mapConversation(conversation);
        const lastMessage = memoryMessages
          .filter((message) => message.conversationId === conversation.id)
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

        return {
          ...mappedConversation,
          participants: mappedConversation.candidateIds
            .map((candidateId) => candidateDirectory.get(candidateId))
            .filter(Boolean),
          lastMessage: lastMessage ? mapMessage(lastMessage) : null
        };
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  const conversations = (await Conversation.find({})
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean()).filter(canSeeConversation);

  const conversationIds = conversations.map((conversation) => String(conversation._id));
  const latestMessages = await Promise.all(
    conversationIds.map(async (conversationId) => {
      const message = await Message.findOne({ conversationId })
        .sort({ createdAt: -1 })
        .lean();
      return [conversationId, message ? mapMessage(message) : null];
    })
  );
  const latestMessageMap = new Map(latestMessages);

  return conversations.map((conversation) => {
    const mappedConversation = mapConversation(conversation);
    return {
      ...mappedConversation,
      participants: mappedConversation.candidateIds
        .map((candidateId) => candidateDirectory.get(candidateId))
        .filter(Boolean),
      lastMessage: latestMessageMap.get(mappedConversation.id) || null
    };
  });
}

async function createMessageRecord(messageData) {
  if (!usingDatabase) {
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...messageData
    };
    memoryMessages.push(message);
    return mapMessage(message);
  }

  const message = new Message(messageData);
  await message.save();
  return mapMessage(message);
}

async function touchConversation(conversationId, updatedAt = new Date()) {
  if (!usingDatabase) {
    const index = memoryConversations.findIndex((conversation) => conversation.id === conversationId);
    if (index !== -1) {
      memoryConversations[index] = {
        ...memoryConversations[index],
        updatedAt: new Date(updatedAt).toISOString()
      };
    }
    return;
  }

  await Conversation.findByIdAndUpdate(conversationId, { updatedAt });
}

app.get("/api", (_request, response) => {
  response.json({
    name: "AI Candidate Management Platform API",
    status: "ok",
    port,
    usingDatabase,
    modules: moduleManifest.length
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    usingDatabase,
    port,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/modules", (_request, response) => {
  response.json({ modules: moduleManifest });
});

// Everything below this line requires a signed-in user.
app.use("/api", requireAuth);
app.use("/api", createAdminRouter({ countCandidatesByCompany, adoptUnassignedCandidates }));
app.use("/api", createJobsRouter({ jobStats: applicationStatsByJob, onJobChanged: refreshJobCandidates }));
app.use(
  "/api",
  createApplicationsRouter({
    findCandidate: findCandidateRecord,
    decorate: withOwnership,
    resumeFor,
    refreshCandidate
  })
);
app.use("/api", createResumesRouter({ findCandidate }));
app.use("/api", createDocumentsRouter({ findCandidate: findCandidateRecord }));

// Sends 404 for candidates the user cannot see (so existence is not revealed) and 403 when
// they can see it but may not do the requested thing. Returns the candidate or null.
async function loadCandidateFor(request, response, allowed) {
  const candidate = await findCandidateRecord(request.params.id);
  if (!candidate || !canViewCandidate(request.user, candidate)) {
    response.status(404).json({ message: "Candidate not found" });
    return null;
  }
  if (!allowed(request.user, candidate)) {
    response.status(403).json({ message: "You do not have permission to do this" });
    return null;
  }
  return candidate;
}

// A candidate can only be linked to a job of its own company.
async function resolveJobFor(jobId, companyId) {
  const job = typeof jobId === "string" ? await findJobById(jobId) : null;
  if (!job || String(job.companyId) !== String(companyId)) return { error: "Job not found in this company" };
  const blocked = applyBlockReason(job, (await listApplicationsByJob(job.id)).length);
  if (blocked) return { error: blocked };
  return { value: job.id };
}

// Owner must be an active user of the candidate's company (admins may own anything).
async function resolveOwner(ownerId, companyId) {
  const owner = typeof ownerId === "string" ? await findUserById(ownerId) : null;
  if (!owner || owner.isActive === false) return { error: "Owner not found" };
  const isAdminUser = effectiveRole(owner) === "admin";
  if (!isAdminUser && (!companyId || String(owner.companyId || "") !== String(companyId))) {
    return { error: "The owner must belong to the candidate's company" };
  }
  return { value: String(owner._id ?? owner.id) };
}

const candidateAuditMeta = (before, after, changedFields) => ({
  changed: changedFields,
  ...(before.status !== after.status ? { status: { from: before.status, to: after.status } } : {})
});

app.get(
  "/api/dashboard",
  requirePermission("candidate:read"),
  asyncHandler(async (request, response) => {
    const candidates = await fetchVisibleCandidates(request.user);
    response.json({
      metrics: buildDashboardMetrics(candidates),
      usingMemoryStore: !usingDatabase
    });
  })
);

app.get(
  "/api/candidates",
  requirePermission("candidate:read"),
  asyncHandler(async (request, response) => {
    const search = typeof request.query.search === "string" ? request.query.search : "";
    const status = typeof request.query.status === "string" ? request.query.status : "all";
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.max(0, parseInt(request.query.limit) || 0);
    const sortField = typeof request.query.sortField === "string" ? request.query.sortField : "score";
    const sortOrder = parseInt(request.query.sortOrder) || -1;

    const jobFilter = typeof request.query.jobId === "string" ? request.query.jobId : "";
    const visible = await fetchVisibleCandidates(request.user, { search, status });
    // jobId=<id> keeps candidates who applied to that job; jobId=none keeps candidates who applied to no job
    let allCandidates = visible;
    if (jobFilter) {
      const byCandidate = await listApplicationsByCandidates(visible.map((candidate) => candidate.id));
      allCandidates = visible.filter((candidate) => {
        const applied = byCandidate.get(candidate.id) || [];
        return jobFilter === "none" ? applied.length === 0 : applied.some((application) => application.jobId === jobFilter);
      });
    }

    // Sort client-side (works for both in-memory and Mongo paths)
    const sorted = [...allCandidates].sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      if (typeof av === "number" && typeof bv === "number") return sortOrder * (av - bv);
      return sortOrder * String(av).localeCompare(String(bv));
    });

    const total = sorted.length;
    const pageItems = limit > 0 ? sorted.slice((page - 1) * limit, page * limit) : sorted;

    response.json({ candidates: await withApplications(await withOwnership(pageItems)), total, usingMemoryStore: !usingDatabase });
  })
);

// 1) POST: Create Candidate. The candidate belongs to the creator's company and the creator owns it.
// Admins are not tied to a company, so they must say which company (companyId).
app.post(
  "/api/candidates",
  requirePermission("candidate:create"),
  asyncHandler(async (request, response) => {
    const { value: candidateData, errors } = validateCandidateInput(request.body);
    if (errors) {
      response.status(400).json({ message: errors[0], errors });
      return;
    }

    let companyId = request.user.companyId;
    if (can(request.user, "company:manage")) {
      const company = await findCompanyById(request.body.companyId);
      if (!company) {
        response.status(400).json({ message: "Choose the company this candidate belongs to (companyId)" });
        return;
      }
      companyId = company.id;
    } else if (!companyId) {
      response.status(403).json({ message: "You are not assigned to a company yet. Ask an admin to add you to one." });
      return;
    }
    candidateData.companyId = companyId;
    candidateData.ownerId = request.user.id;

    // jobId is a shortcut for "apply this candidate to a job" (more jobs can be added later)
    let applyToJob = null;
    if (request.body.jobId !== undefined && request.body.jobId !== null && request.body.jobId !== "") {
      const job = await resolveJobFor(request.body.jobId, companyId);
      if (job.error) {
        response.status(400).json({ message: job.error });
        return;
      }
      applyToJob = job.value;
    }

    let resumeToLink = null;
    if (request.body.resumeId !== undefined && request.body.resumeId !== null && request.body.resumeId !== "") {
      const resume = await resolveResumeFor(request.body.resumeId, companyId);
      if (resume.error) {
        response.status(400).json({ message: resume.error });
        return;
      }
      resumeToLink = resume.value;
      candidateData.resumeId = resume.value.id;
    }

    let created;
    if (!usingDatabase) {
      if (memoryCandidates.some((c) => c.email?.toLowerCase() === candidateData.email && (c.companyId || "") === companyId)) {
        response.status(409).json({ message: "A candidate with this email already exists" });
        return;
      }
      // Same defaults as the MongoDB schema, so both stores behave alike.
      const newCand = {
        id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: "screening",
        score: 0,
        stage: "New application",
        location: "Remote",
        experienceYears: 0,
        skills: [],
        summary: "",
        notes: [],
        interviews: [],
        ...candidateData
      };
      memoryCandidates.push(newCand);
      created = mapCandidate(newCand);
    } else {
      try {
        const candidate = new Candidate(candidateData);
        await candidate.save();
        created = mapCandidate(candidate);
      } catch (error) {
        if (error?.code === 11000) {
          response.status(409).json({ message: "A candidate with this email already exists" });
          return;
        }
        throw error;
      }
    }

    if (resumeToLink) await setResumeCandidate(resumeToLink.id, created.id);
    if (applyToJob) {
      await createApplication({ companyId, candidateId: created.id, jobId: applyToJob, createdBy: request.user.id });
      await refreshCandidate(created.id);
      created = (await findCandidateRecord(created.id)) || created;
    }

    await recordAudit({
      actor: request.user,
      action: "candidate.created",
      entityType: "candidate",
      entityId: created.id,
      companyId,
      summary: `Added candidate ${created.name}`,
      meta: { status: created.status, ...(resumeToLink ? { resumeId: resumeToLink.id } : {}), ...(applyToJob ? { jobId: applyToJob } : {}) }
    });
    response.status(201).json(await withOwnership(created));
  })
);

// 2) PUT: Update Candidate (profile fields, notes and interviews).
// Profile changes need edit rights; changing only notes/interviews needs annotate rights
// (hiring managers). Owner and company are changed through /assignment, never here.
app.put(
  "/api/candidates/:id",
  asyncHandler(async (request, response) => {
    const { value: updateData, errors } = validateCandidateInput(request.body, { partial: true });
    if (errors) {
      response.status(400).json({ message: errors[0], errors });
      return;
    }
    const resumeIdInBody = typeof request.body?.resumeId === "string" && request.body.resumeId !== "";
    const changedFields = [...Object.keys(updateData), ...(resumeIdInBody ? ["resumeId"] : [])];
    const touchesProfile = changedFields.some((field) => !["notes", "interviews"].includes(field));

    const existing = await loadCandidateFor(
      request,
      response,
      touchesProfile ? canEditCandidate : canAnnotateCandidate
    );
    if (!existing) return;

    // With job applications the stage belongs to each job (move it on the job's board), not to the candidate.
    if (updateData.status !== undefined && (await listApplicationsByCandidate(existing.id)).length > 0) {
      response.status(400).json({ message: "This candidate has job applications: move them on each job's board instead." });
      return;
    }

    let resumeToLink = null;
    if (resumeIdInBody && request.body.resumeId !== existing.resumeId) {
      const resume = await resolveResumeFor(request.body.resumeId, existing.companyId, existing.id);
      if (resume.error) {
        response.status(400).json({ message: resume.error });
        return;
      }
      resumeToLink = resume.value;
      updateData.resumeId = resume.value.id;
    }

    if (updateData.email && updateData.email !== existing.email) {
      const clash = (await fetchCandidates()).some((c) => c.id !== existing.id && (c.companyId || "") === (existing.companyId || "") && c.email?.toLowerCase() === updateData.email);
      if (clash) {
        response.status(409).json({ message: "A candidate with this email already exists" });
        return;
      }
    }

    const updated = await setCandidateFields(existing.id, updateData);
    if (!updated) {
      response.status(404).json({ message: "Candidate not found" });
      return;
    }
    if (resumeToLink) {
      await setResumeCandidate(resumeToLink.id, updated.id);
      if (existing.resumeId) await discardResume(existing.resumeId); // replaced
    }
    await refreshCandidate(updated.id); // profile or resume changes move the job fit scores

    await recordAudit({
      actor: request.user,
      action: "candidate.updated",
      entityType: "candidate",
      entityId: updated.id,
      companyId: updated.companyId,
      summary: `Updated ${updated.name}: ${changedFields.join(", ") || "no changes"}`,
      meta: candidateAuditMeta(existing, updated, changedFields)
    });
    response.json(await withOwnership((await findCandidateRecord(updated.id)) || updated));
  })
);

// Change the owner and/or company. Admins can assign any user of the candidate's company and can move
// the candidate to another company; owners (and any recruiter, for candidates with no owner) can only assign
// the candidate to themselves.
app.put(
  "/api/candidates/:id/assignment",
  asyncHandler(async (request, response) => {
    const existing = await loadCandidateFor(request, response, canAssignCandidate);
    if (!existing) return;

    const body = request.body || {};
    const isPlatformAdmin = can(request.user, "company:manage");
    const changes = {};

    if (body.companyId !== undefined) {
      if (!isPlatformAdmin) {
        response.status(403).json({ message: "Only admins can move a candidate to another company" });
        return;
      }
      const company = await findCompanyById(body.companyId);
      if (!company) {
        response.status(400).json({ message: "Company not found" });
        return;
      }
      changes.companyId = company.id;
    }

    const targetCompanyId = changes.companyId ?? existing.companyId;
    if (body.ownerId !== undefined) {
      if (body.ownerId === null || body.ownerId === "") {
        if (!isPlatformAdmin) {
          response.status(403).json({ message: "Only admins can clear the owner" });
          return;
        }
        changes.ownerId = null;
      } else {
        const owner = await resolveOwner(body.ownerId, targetCompanyId);
        if (owner.error) {
          response.status(400).json({ message: owner.error });
          return;
        }
        if (!isPlatformAdmin && owner.value !== request.user.id) {
          response.status(403).json({ message: "You can only assign candidates to yourself" });
          return;
        }
        changes.ownerId = owner.value;
      }
    } else if (changes.companyId && existing.ownerId && changes.companyId !== existing.companyId) {
      // Moving to another company: the previous owner stays only if they belong there (or are an admin).
      const keep = await resolveOwner(existing.ownerId, changes.companyId);
      if (keep.error) changes.ownerId = null;
    }

    if (Object.keys(changes).length === 0) {
      response.status(400).json({ message: "ownerId or companyId is required" });
      return;
    }

    let updated;
    if (usingDatabase) {
      const update = { $set: {}, $unset: {} };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) update.$unset[key] = 1;
        else update.$set[key] = value;
      }
      if (Object.keys(update.$set).length === 0) delete update.$set;
      if (Object.keys(update.$unset).length === 0) delete update.$unset;
      const doc = await Candidate.findByIdAndUpdate(existing.id, update, { new: true }).lean();
      updated = doc ? mapCandidate(doc) : null;
    } else {
      const fields = {};
      for (const [key, value] of Object.entries(changes)) fields[key] = value === null ? undefined : value;
      updated = await setCandidateFields(existing.id, fields);
    }
    if (!updated) {
      response.status(404).json({ message: "Candidate not found" });
      return;
    }

    await recordAudit({
      actor: request.user,
      action: "candidate.assigned",
      entityType: "candidate",
      entityId: updated.id,
      companyId: updated.companyId,
      summary: `Changed ownership of ${updated.name}`,
      meta: {
        ...(changes.ownerId !== undefined ? { ownerId: { from: existing.ownerId, to: updated.ownerId } } : {}),
        ...(changes.companyId !== undefined ? { companyId: { from: existing.companyId, to: updated.companyId } } : {})
      }
    });
    response.json(await withOwnership(updated));
  })
);

// Activity for one candidate (anyone who can see the candidate). Actor emails are admin-only.
app.get(
  "/api/candidates/:id/audit",
  asyncHandler(async (request, response) => {
    const candidate = await loadCandidateFor(request, response, canViewCandidate);
    if (!candidate) return;
    const entries = await listAudit({ entityType: "candidate", entityId: candidate.id, limit: request.query.limit });
    const isAdmin = can(request.user, "audit:read");
    response.json({
      entries: entries.map(({ actorEmail, actorId, ...entry }) => (isAdmin ? { ...entry, actorId, actorEmail } : entry))
    });
  })
);

// 3) DELETE: Delete Candidate (admins, or the recruiter who owns it)
app.delete(
  "/api/candidates/:id",
  asyncHandler(async (request, response) => {
    const existing = await loadCandidateFor(request, response, canDeleteCandidate);
    if (!existing) return;

    if (!usingDatabase) {
      memoryCandidates = memoryCandidates.filter((c) => c.id !== existing.id);
    } else {
      await Candidate.findByIdAndDelete(existing.id);
    }
    await deleteApplicationsByCandidate(existing.id);
    await discardResume(existing.resumeId); // the personal data in the file goes with the candidate
    for (const doc of await deleteDocumentsByCandidate(existing.id)) await removeFile(doc.storedName);

    await recordAudit({
      actor: request.user,
      action: "candidate.deleted",
      entityType: "candidate",
      entityId: existing.id,
      companyId: existing.companyId,
      summary: `Deleted candidate ${existing.name}`,
      meta: { status: existing.status }
    });
    response.json({ success: true });
  })
);

const ownsConversation = canSeeConversationFor;

app.use("/api/conversations", requirePermission("chat:use"));

app.get(
  "/api/conversations",
  asyncHandler(async (request, response) => {
    const conversations = await fetchConversationSummaries(request.user);
    response.json({ conversations, usingMemoryStore: !usingDatabase });
  })
);

app.post(
  "/api/conversations",
  asyncHandler(async (request, response) => {
    const candidateIds = Array.isArray(request.body.candidateIds)
      ? request.body.candidateIds.map(String)
      : [];
    const type = request.body.type === "group" ? "group" : "individual";
    const title = String(request.body.title || "").trim();
    const requestedCandidateIds =
      type === "individual" ? candidateIds.slice(0, 1) : candidateIds;

    if (requestedCandidateIds.length === 0) {
      return response.status(400).json({ message: "At least one candidate is required." });
    }

    if (!title) {
      return response.status(400).json({ message: "Conversation title is required." });
    }

    const candidateDirectory = await getCandidateDirectory(request.user);
    const missingCandidateIds = requestedCandidateIds.filter(
      (candidateId) => !candidateDirectory.has(candidateId)
    );

    if (missingCandidateIds.length > 0) {
      return response.status(400).json({ message: "One or more candidates were not found." });
    }

    // A conversation belongs to one company, so it can never mix candidates from different companies.
    const companyIds = new Set(requestedCandidateIds.map((id) => candidateDirectory.get(id).companyId || ""));
    if (companyIds.size > 1) {
      return response.status(400).json({ message: "A conversation can only include candidates from one company." });
    }
    const conversationCompanyId = [...companyIds][0] || null;

    if (!usingDatabase) {
      const now = new Date().toISOString();
      const conversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        candidateIds: requestedCandidateIds,
        title,
        ownerId: request.user.id,
        companyId: conversationCompanyId,
        createdAt: now,
        updatedAt: now
      };
      memoryConversations.unshift(conversation);
      response.status(201).json({
        conversation: {
          ...mapConversation(conversation),
          participants: requestedCandidateIds
            .map((candidateId) => candidateDirectory.get(candidateId))
            .filter(Boolean),
          lastMessage: null
        },
        usingMemoryStore: true
      });
      return;
    }

    const conversation = new Conversation({
      type,
      candidateIds: requestedCandidateIds,
      title,
      ownerId: request.user.id,
      companyId: conversationCompanyId
    });
    await conversation.save();

    response.status(201).json({
      conversation: {
        ...mapConversation(conversation),
        participants: requestedCandidateIds
          .map((candidateId) => candidateDirectory.get(candidateId))
          .filter(Boolean),
        lastMessage: null
      },
      usingMemoryStore: false
    });
  })
);

app.get(
  "/api/conversations/:id/messages",
  asyncHandler(async (request, response) => {
    const conversation = await fetchConversationById(request.params.id);
    if (!conversation || !ownsConversation(request.user, conversation)) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    const messages = await fetchConversationMessages(conversation.id);
    response.json({ conversation, messages, usingMemoryStore: !usingDatabase });
  })
);

app.post(
  "/api/conversations/:id/messages",
  asyncHandler(async (request, response) => {
    const conversation = await fetchConversationById(request.params.id);
    if (!conversation || !ownsConversation(request.user, conversation)) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    const text = String(request.body.text || "").trim();
    const attachments = Array.isArray(request.body.attachments)
      ? request.body.attachments
          .map((file) => ({
            name: String(file?.name || "").trim(),
            type: String(file?.type || "").trim(),
            size: Number(file?.size || 0),
            content: String(file?.content || "").trim()
          }))
          .filter((file) => file.name.length > 0)
      : [];
    if (!text && attachments.length === 0) {
      return response.status(400).json({ message: "Message text or attachment is required." });
    }

    const recruiterMessage = await createMessageRecord({
      conversationId: conversation.id,
      sender: "recruiter",
      senderName: request.user.name || "Recruiter",
      text: text || "Shared attachments",
      attachments
    });

    const candidateDirectory = await getCandidateDirectory(request.user);
    const participantNames = conversation.candidateIds
      .map((candidateId) => candidateDirectory.get(candidateId)?.name)
      .filter(Boolean);
    const replyName =
      participantNames.length > 1 ? `${participantNames[0]} and team` : participantNames[0] || "Candidate";
    const autoReply = await createMessageRecord({
      conversationId: conversation.id,
      sender: "candidate",
      senderName: replyName,
      text: generateCandidateReply(replyName, text)
    });

    const updatedAt = autoReply.createdAt || recruiterMessage.createdAt || new Date().toISOString();
    await touchConversation(conversation.id, updatedAt);

    response.status(201).json({
      message: recruiterMessage,
      autoReply,
      updatedAt,
      usingMemoryStore: !usingDatabase
    });
  })
);

app.delete(
  "/api/conversations/:id",
  asyncHandler(async (request, response) => {
    const conversationId = request.params.id;
    const existingConversation = await fetchConversationById(conversationId);
    if (!existingConversation || !ownsConversation(request.user, existingConversation)) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    if (!usingDatabase) {
      const conversationIndex = memoryConversations.findIndex(
        (conversation) => conversation.id === conversationId
      );

      if (conversationIndex === -1) {
        return response.status(404).json({ message: "Conversation not found." });
      }

      memoryConversations.splice(conversationIndex, 1);
      memoryMessages = memoryMessages.filter((message) => message.conversationId !== conversationId);
      response.json({ success: true, usingMemoryStore: true });
      return;
    }

    const deletedConversation = await Conversation.findByIdAndDelete(conversationId);
    if (!deletedConversation) {
      return response.status(404).json({ message: "Conversation not found." });
    }

    await Message.deleteMany({ conversationId });
    response.json({ success: true, usingMemoryStore: false });
  })
);

const COMMAND_PERMISSIONS = {
  update_status: canEditCandidate,
  add_note: canAnnotateCandidate,
  schedule_interview: canAnnotateCandidate
};

app.post(
  "/api/chat",
  requirePermission("candidate:read"),
  asyncHandler(async (request, response) => {
    // The assistant only ever sees, and can only act on, candidates this user may see.
    const candidates = await fetchVisibleCandidates(request.user);
    const message = typeof request.body.message === "string" ? request.body.message : "";

    // Parse conversational command
    const parsed = parseAiMessage(message, candidates);
    let reply = "";
    let actionExecuted = false;
    let replySource = "rules";

    if (parsed) {
      actionExecuted = true;
      reply = parsed.reply;

      const target = candidates.find((candidate) => candidate.id === parsed.candidateId);
      const mayAct = COMMAND_PERMISSIONS[parsed.command];
      if (parsed.command !== "summarize" && mayAct && !mayAct(request.user, target)) {
        // Same permission rules as the UI: the assistant cannot do more than the user can.
        response.json({
          reply: "Your role does not allow that action on this candidate.",
          actionExecuted: false,
          source: "rules",
          usingMemoryStore: !usingDatabase
        });
        return;
      }

      if (parsed.command === "update_status") {
        // With job applications the stage is per job: one application moves, several need the board.
        const applied = await listApplicationsByCandidate(parsed.candidateId);
        if (applied.length > 1) {
          response.json({
            reply: `${target?.name || "This candidate"} has applied to ${applied.length} jobs, so the stage is set per job. Open the job's pipeline board to move them.`,
            actionExecuted: false,
            source: "rules",
            usingMemoryStore: !usingDatabase
          });
          return;
        }
        if (applied.length === 1) {
          await updateApplicationStatus(applied[0].id, parsed.args.status);
          await refreshCandidate(parsed.candidateId);
        } else {
          await setCandidateFields(parsed.candidateId, parsed.args);
        }
      } else if (parsed.command === "add_note") {
        const newNote = {
          author: "AI Copilot",
          text: parsed.args.text,
          createdAt: new Date()
        };
        if (usingDatabase) {
          await Candidate.findByIdAndUpdate(parsed.candidateId, {
            $push: { notes: newNote }
          });
        } else {
          const idx = memoryCandidates.findIndex((c) => c.id === parsed.candidateId);
          if (idx !== -1) {
            if (!memoryCandidates[idx].notes) memoryCandidates[idx].notes = [];
            memoryCandidates[idx].notes.push(newNote);
          }
        }
      } else if (parsed.command === "schedule_interview") {
        if (usingDatabase) {
          await Candidate.findByIdAndUpdate(parsed.candidateId, {
            $push: { interviews: parsed.args }
          });
        } else {
          const idx = memoryCandidates.findIndex((c) => c.id === parsed.candidateId);
          if (idx !== -1) {
            if (!memoryCandidates[idx].interviews) memoryCandidates[idx].interviews = [];
            memoryCandidates[idx].interviews.push(parsed.args);
          }
        }
      } else if (parsed.command === "summarize") {
        // Just general profiling, no database modifications
        actionExecuted = false;
      }

      if (actionExecuted) {
        await recordAudit({
          actor: request.user,
          source: "ai",
          action: `candidate.ai_${parsed.command}`,
          entityType: "candidate",
          entityId: parsed.candidateId,
          companyId: target?.companyId,
          summary: `Assistant ran "${parsed.command}" on ${parsed.candidateName || "a candidate"} at ${request.user.email}'s request`,
          meta: {
            command: parsed.command,
            ...(parsed.command === "update_status" && target ? { status: { from: target.status, to: parsed.args.status } } : {})
          }
        });
      }
    } else {
      const llm = await generateLlmReply({ message, candidates });
      reply = llm ? llm.reply : generateAiReply(message, candidates);
      replySource = llm ? llm.source : "rules";
    }

    response.json({ reply, actionExecuted, source: replySource, usingMemoryStore: !usingDatabase });
  })
);

app.get(
  "/api/analytics",
  requirePermission("analytics:read"),
  asyncHandler(async (request, response) => {
    const candidates = await fetchVisibleCandidates(request.user);

    // Status breakdown
    const statusBreakdown = candidates.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});

    // Stage distribution
    const stageDistribution = candidates.reduce((acc, c) => {
      const stage = c.stage || "Unknown";
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {});

    // Top skills frequency
    const skillFrequency = candidates.reduce((acc, c) => {
      (c.skills || []).forEach((skill) => {
        acc[skill] = (acc[skill] || 0) + 1;
      });
      return acc;
    }, {});
    const topSkills = Object.entries(skillFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    // Experience distribution
    const experienceBuckets = { "0-2 yrs": 0, "3-5 yrs": 0, "6-10 yrs": 0, "10+ yrs": 0 };
    candidates.forEach((c) => {
      const yrs = c.experienceYears || 0;
      if (yrs <= 2) experienceBuckets["0-2 yrs"]++;
      else if (yrs <= 5) experienceBuckets["3-5 yrs"]++;
      else if (yrs <= 10) experienceBuckets["6-10 yrs"]++;
      else experienceBuckets["10+ yrs"]++;
    });

    // Top candidates by score
    const topCandidates = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => ({ name: c.name, role: c.role, score: c.score, status: c.status }));

    // Average score
    const avgScore =
      candidates.length > 0
        ? Math.round(candidates.reduce((sum, c) => sum + (c.score || 0), 0) / candidates.length)
        : 0;

    response.json({
      total: candidates.length,
      avgScore,
      statusBreakdown,
      stageDistribution,
      topSkills,
      experienceBuckets,
      topCandidates,
      usingMemoryStore: !usingDatabase
    });
  })
);

// Resets the demo data. Only the "Demo Company" is touched; other companies' data is never deleted.
app.post(
  "/api/seed",
  requirePermission("data:seed"),
  asyncHandler(async (request, response) => {
    if (process.env.NODE_ENV === "production") {
      response.status(403).json({ error: "Seeding is disabled in production" });
      return;
    }

    const demo = await ensureDemoCompany();
    await recordAudit({
      actor: request.user,
      action: "data.seeded",
      entityType: "system",
      companyId: demo.id,
      summary: `Reset demo data in "${demo.name}"`
    });

    if (!usingDatabase) {
      memoryCandidates = [
        ...memoryCandidates.filter((candidate) => candidate.companyId !== demo.id),
        ...seedCandidates.map((candidate, index) => ({
          id: `demo-${index + 1}`,
          notes: [],
          interviews: [],
          ...candidate,
          companyId: demo.id
        }))
      ];
      const demoConversationIds = new Set(
        memoryConversations.filter((conversation) => conversation.companyId === demo.id).map((conversation) => conversation.id)
      );
      memoryConversations = memoryConversations.filter((conversation) => conversation.companyId !== demo.id);
      memoryMessages = memoryMessages.filter((message) => !demoConversationIds.has(message.conversationId));

      response.status(201).json({ count: seedCandidates.length, usingMemoryStore: true });
      return;
    }

    await Candidate.deleteMany({ companyId: demo.id });
    const demoConversations = await Conversation.find({ companyId: demo.id }, { _id: 1 }).lean();
    await Message.deleteMany({ conversationId: { $in: demoConversations.map((conversation) => String(conversation._id)) } });
    await Conversation.deleteMany({ companyId: demo.id });
    const created = await Candidate.insertMany(seedCandidates.map((candidate) => ({ ...candidate, companyId: demo.id })));
    response.status(201).json({ count: created.length, usingMemoryStore: false });
  })
);

app.use((error, _request, response, _next) => {
  // Client errors (bad JSON, body too large, ...) keep their status; everything else is a 500.
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) console.error("API request failed:", error);
  response.status(status).json({
    message: status === 500 ? error.message || "Internal server error" : error.type === "entity.too.large" ? "The upload is too large" : error.message,
    usingMemoryStore: !usingDatabase
  });
});

app.listen(port, () => {
  console.log(`API server running on http://localhost:${port}`);
});
