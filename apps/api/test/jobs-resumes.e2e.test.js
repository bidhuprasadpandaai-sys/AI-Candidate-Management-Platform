// End-to-end tests for job openings, the per-job pipeline, and resume upload/parsing.
// Runs the real API (in-memory store by default) with a fake SMTP server and a fake Ollama.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { SAMPLE_RESUME_LINES, makeDocx, makePdf } from "./helpers/fixtures.js";
import { startApi } from "./helpers/server.js";

let api;
let ai;
let admin;
let alice; // recruiter, Company A
let hana; // hiring manager, Company A
let vic; // read-only, Company A
let bob; // recruiter, Company B
let nora; // no company
let storage;
const aiRequests = [];
const ids = {};
const password = "Strong123";

async function register(client, name, email) {
  assert.equal((await client.post("/auth/signup", { name, email, password })).status, 201);
  const signin = await client.post("/auth/signin", { email, password });
  assert.equal(signin.status, 200);
  return signin.data.user;
}

before(async () => {
  storage = fs.mkdtempSync(path.join(os.tmpdir(), "acmp-resumes-"));
  ai = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      aiRequests.push(JSON.parse(raw || "{}"));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: '{"role":"Product Designer","experienceYears":5,"skills":["Figma"],"summary":"Designs products."}' } }] }));
    });
  });
  await new Promise((resolve) => ai.listen(0, "127.0.0.1", resolve));
  api = await startApi({
    MONGODB_URI: process.env.E2E_MONGODB_URI || "",
    RESUME_STORAGE_DIR: storage,
    LLM_PROVIDER: "ollama",
    OLLAMA_HOST: `http://127.0.0.1:${ai.address().port}`,
    OLLAMA_MODEL: "fake"
  });
  [admin, alice, hana, vic, bob, nora] = [1, 2, 3, 4, 5, 6].map(() => api.client());

  const a = await register(admin, "Admin One", "admin@example.com");
  ids.admin = a.id;
  for (const [client, name, email, key] of [
    [alice, "Alice", "alice@example.com", "alice"],
    [hana, "Hana Manager", "hana@example.com", "hana"],
    [vic, "Vic Viewer", "vic@example.com", "vic"],
    [bob, "Bob", "bob@example.com", "bob"],
    [nora, "Nora", "nora@example.com", "nora"]
  ]) ids[key] = (await register(client, name, email)).id;

  ids.A = (await admin.post("/companies", { name: "Acme Corp" })).data.company.id;
  ids.B = (await admin.post("/companies", { name: "Globex Ltd" })).data.company.id;
  const assign = (key, accessRole, companyId) => admin.patch(`/users/${ids[key]}`, { accessRole, companyId });
  await assign("alice", "recruiter", ids.A);
  await assign("hana", "hiring_manager", ids.A);
  await assign("vic", "viewer", ids.A);
  await assign("bob", "recruiter", ids.B);
  await assign("nora", "recruiter", null);
});

after(async () => {
  await api.stop();
  ai.close();
  fs.rmSync(storage, { recursive: true, force: true });
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

test("recruiters create jobs in their company; hiring manager must belong to it", async () => {
  const created = await alice.post("/jobs", {
    title: "  Senior Engineer ", department: "Engineering", location: "Remote", status: "open",
    hiringManagerId: ids.hana, description: "Build APIs", companyId: ids.B
  });
  assert.equal(created.status, 201);
  const job = created.data.job;
  assert.equal(job.title, "Senior Engineer");
  assert.equal(job.companyId, ids.A, "companyId in the body is ignored for non-admins");
  assert.equal(job.companyName, "Acme Corp");
  assert.equal(job.hiringManagerName, "Hana Manager");
  assert.equal(job.candidateCount, 0);
  ids.jobA = job.id;

  assert.equal((await alice.post("/jobs", { title: "X", hiringManagerId: ids.bob })).status, 400, "manager from another company");
  assert.equal((await alice.post("/jobs", { title: "X", hiringManagerId: "nobody" })).status, 400);
  assert.equal((await alice.post("/jobs", {})).status, 400);
  assert.equal((await alice.post("/jobs", { title: "X", status: "archived" })).status, 400);
  assert.equal((await alice.post("/jobs", { title: "x".repeat(121) })).status, 400);
  assert.equal((await alice.post("/jobs", { title: { $ne: "" } })).status, 400);
  assert.equal((await alice.post("/jobs", { title: "Y", isAdmin: true, createdBy: "x" })).data.job.createdBy, ids.alice, "unknown fields are dropped");
});

test("hiring-manager choices: active non-read-only users of the same company", async () => {
  const names = (await alice.get("/jobs/hiring-managers")).data.users.map((u) => u.name).sort();
  assert.deepEqual(names, ["Alice", "Hana Manager"], "no read-only users, nobody from another company");
  assert.equal((await hana.get("/jobs/hiring-managers")).status, 403);
  assert.equal((await vic.get("/jobs/hiring-managers")).status, 403);
  assert.deepEqual((await nora.get("/jobs/hiring-managers")).data?.users ?? [], []);
  const forB = (await admin.get(`/jobs/hiring-managers?companyId=${ids.B}`)).data.users.map((u) => u.name);
  assert.deepEqual(forB, ["Bob"]);
});

test("job permissions: everyone in the company reads, only recruiters and admins write", async () => {
  for (const client of [hana, vic]) {
    assert.equal((await client.get("/jobs")).data.jobs.length >= 1, true);
    assert.equal((await client.get(`/jobs/${ids.jobA}`)).status, 200);
    assert.equal((await client.post("/jobs", { title: "Nope" })).status, 403);
    assert.equal((await client.patch(`/jobs/${ids.jobA}`, { title: "Nope" })).status, 403);
    assert.equal((await client.delete(`/jobs/${ids.jobA}`)).status, 403);
  }
  const noCompany = await nora.post("/jobs", { title: "Orphan" });
  assert.equal(noCompany.status, 403);
  assert.deepEqual((await nora.get("/jobs")).data.jobs, []);
});

test("job isolation: another company cannot see, change or delete a job; admins must name the company", async () => {
  assert.equal((await bob.get(`/jobs/${ids.jobA}`)).status, 404);
  assert.equal((await bob.patch(`/jobs/${ids.jobA}`, { title: "Hijack" })).status, 404);
  assert.equal((await bob.delete(`/jobs/${ids.jobA}`)).status, 404);
  assert.equal((await bob.get("/jobs")).data.jobs.length, 0);

  assert.equal((await admin.post("/jobs", { title: "No company" })).status, 400);
  const fromAdmin = await admin.post("/jobs", { title: "Designer", companyId: ids.B });
  assert.equal(fromAdmin.status, 201);
  ids.jobB = fromAdmin.data.job.id;
  assert.equal((await bob.get("/jobs")).data.jobs.length, 1);
  assert.equal((await alice.get(`/jobs/${ids.jobB}`)).status, 404);
  assert.equal((await admin.get("/jobs")).data.jobs.length >= 3, true, "admin sees all companies' jobs");
  assert.equal((await admin.get(`/jobs?companyId=${ids.B}`)).data.jobs.every((j) => j.companyId === ids.B), true);
});

test("jobs can be updated (status, manager) and the change is audited", async () => {
  const updated = await alice.patch(`/jobs/${ids.jobA}`, { status: "on_hold", hiringManagerId: null });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.job.status, "on_hold");
  assert.equal(updated.data.job.hiringManagerName, null);
  assert.equal((await alice.patch(`/jobs/${ids.jobA}`, {})).status, 400);
  assert.equal((await alice.patch(`/jobs/${ids.jobA}`, { status: "bogus" })).status, 400);
  assert.equal((await alice.patch(`/jobs/${ids.jobA}`, { hiringManagerId: ids.bob })).status, 400);
  await alice.patch(`/jobs/${ids.jobA}`, { status: "open", hiringManagerId: ids.hana });

  const entries = (await admin.get("/audit?action=job.updated")).data.entries;
  assert.ok(entries.some((e) => e.meta.status?.to === "on_hold" && e.companyId === ids.A));
});

test("a candidate can apply to several jobs; each application has its own stage and fit score", async () => {
  const ada = (await alice.post("/candidates", { name: "Ada Lovelace", email: "ada@example.com", role: "Software Engineer", skills: ["Node.js"], experienceYears: 6 })).data;
  const grace = (await alice.post("/candidates", { name: "Grace Hopper", email: "grace@example.com", role: "Designer", skills: ["Figma"], experienceYears: 3 })).data;
  ids.cand1 = ada.id;
  ids.cand2 = grace.id;
  const jobB2 = (await alice.post("/jobs", {
    title: "Product Designer", location: "Remote", description: "3+ years of experience. Figma and CSS."
  })).data.job;
  ids.jobA2 = jobB2.id;
  const jobA = (await alice.patch(`/jobs/${ids.jobA}`, { description: "We need 5+ years of experience building APIs with Node.js, PostgreSQL and AWS." })).data.job;

  // applying
  const apply = (client, candidateId, jobId) => client.post(`/candidates/${candidateId}/applications`, { jobId });
  const first = await apply(alice, ada.id, ids.jobA);
  assert.equal(first.status, 201);
  assert.equal(first.data.application.status, "screening");
  assert.equal((await apply(alice, ada.id, ids.jobA)).status, 409, "once per job");
  assert.equal((await apply(alice, ada.id, ids.jobB)).status, 400, "a job of another company");
  assert.equal((await apply(alice, ada.id, "nope")).status, 400);
  assert.equal((await apply(alice, "nope", ids.jobA)).status, 404);
  assert.equal((await apply(hana, ada.id, ids.jobA2)).status, 403);
  assert.equal((await apply(vic, ada.id, ids.jobA2)).status, 403);
  assert.equal((await apply(bob, ada.id, ids.jobA2)).status, 404, "another company cannot see the candidate");
  assert.equal((await apply(api.client(), ada.id, ids.jobA2)).status, 401);
  assert.equal((await apply(alice, ada.id, ids.jobA2)).status, 201, "a second job");
  assert.equal((await apply(alice, grace.id, ids.jobA2)).status, 201);
  await alice.patch(`/jobs/${ids.jobA2}`, { status: "closed" });
  assert.equal((await apply(alice, grace.id, ids.jobA)).status, 201);
  const closed = await alice.post("/jobs", { title: "Closed One", status: "closed" });
  assert.equal((await apply(alice, grace.id, closed.data.job.id)).status, 400, "closed jobs take no applications");
  await alice.patch(`/jobs/${ids.jobA2}`, { status: "open" });

  // the candidate's own view: every job with the full fit breakdown
  const mine = (await alice.get(`/candidates/${ada.id}/applications`)).data.applications;
  assert.equal(mine.length, 2);
  const forA = mine.find((a) => a.job.id === ids.jobA);
  const forA2 = mine.find((a) => a.job.id === ids.jobA2);
  assert.equal(forA.fit.breakdown.length, 5);
  assert.deepEqual(forA.fit.matchedSkills, ["Node.js"]);
  assert.ok(forA.fit.score > forA2.fit.score, "Ada fits the backend job better than the design job");
  assert.notEqual(forA.fit.score, forA2.fit.score);
  assert.equal(mine[0].fit.score >= mine[1].fit.score, true, "best fit first");
  assert.equal((await hana.get(`/candidates/${ada.id}/applications`)).status, 200);
  assert.equal((await vic.get(`/candidates/${ada.id}/applications`)).status, 200);
  assert.equal((await bob.get(`/candidates/${ada.id}/applications`)).status, 404);

  // the job board: this job's applications with the fit for this job
  const board = (await alice.get(`/jobs/${ids.jobA}/applications`)).data;
  assert.equal(board.job.title, "Senior Engineer");
  assert.deepEqual(board.applications.map((a) => a.candidate.name).sort(), ["Ada Lovelace", "Grace Hopper"]);
  assert.equal(board.applications.every((a) => a.status === "screening"), true);
  assert.equal(board.applications[0].fit.score >= board.applications[1].fit.score, true);
  assert.equal(board.applications[0].candidate.name, "Ada Lovelace");
  assert.equal(typeof board.applications[0].fit.level, "string");
  assert.equal((await hana.get(`/jobs/${ids.jobA}/applications`)).status, 200);
  assert.equal((await bob.get(`/jobs/${ids.jobA}/applications`)).status, 404);
  assert.equal((await nora.get(`/jobs/${ids.jobA}/applications`)).status, 404);

  // moving one application moves only that job's card
  const adaOnA = board.applications.find((a) => a.candidate.id === ada.id);
  assert.equal((await alice.patch(`/applications/${adaOnA.id}`, { status: "interview" })).status, 200);
  const boardA = (await alice.get(`/jobs/${ids.jobA}/applications`)).data.applications;
  const boardA2 = (await alice.get(`/jobs/${ids.jobA2}/applications`)).data.applications;
  assert.equal(boardA.find((a) => a.candidate.id === ada.id).status, "interview");
  assert.equal(boardA2.find((a) => a.candidate.id === ada.id).status, "screening", "the other job is unchanged");
  assert.equal((await alice.get(`/jobs/${ids.jobA}`)).data.job.statusCounts.interview, 1);

  // the candidate's own status follows the furthest stage; it cannot be edited directly any more
  const adaNow = (await alice.get("/candidates?search=Ada")).data.candidates.find((c) => c.id === ada.id);
  assert.equal(adaNow.status, "interview");
  assert.equal(adaNow.applications.length, 2);
  assert.deepEqual(adaNow.applications.map((a) => a.jobTitle).sort(), ["Product Designer", "Senior Engineer"]);
  assert.equal(adaNow.score, Math.max(...adaNow.applications.map((a) => a.score)), "score is the best fit");
  const direct = await alice.put(`/candidates/${ada.id}`, { status: "offer" });
  assert.equal(direct.status, 400);
  assert.match(direct.data.message, /each job's board/);
  assert.equal((await alice.put(`/candidates/${ada.id}`, { stage: "Phone screen" })).status, 200);

  // permissions and validation on moves
  assert.equal((await alice.patch(`/applications/${adaOnA.id}`, { status: "boss" })).status, 400);
  for (const client of [hana, vic]) assert.equal((await client.patch(`/applications/${adaOnA.id}`, { status: "offer" })).status, 403);
  assert.equal((await bob.patch(`/applications/${adaOnA.id}`, { status: "offer" })).status, 404);
  assert.equal((await alice.patch("/applications/nope", { status: "offer" })).status, 404);

  // the candidate's profile and the job description both drive the fit
  const before = (await alice.get(`/candidates/${ada.id}/applications`)).data.applications.find((a) => a.job.id === ids.jobA).fit.score;
  await alice.put(`/candidates/${ada.id}`, { skills: ["Node.js", "AWS", "PostgreSQL"], experienceYears: 7 });
  const after = (await alice.get(`/candidates/${ada.id}/applications`)).data.applications.find((a) => a.job.id === ids.jobA).fit.score;
  assert.ok(after > before + 15, `${after} vs ${before}`);
  assert.equal((await alice.get("/candidates?search=Ada")).data.candidates[0].score, after, "the stored best-fit score follows profile edits");
  await alice.patch(`/jobs/${ids.jobA}`, { description: "Kubernetes, Terraform and GraphQL experts only. 10+ years." });
  const lowered = (await alice.get("/candidates?search=Ada")).data.candidates[0];
  assert.ok(lowered.applications.find((a) => a.jobId === ids.jobA).score < after, "a new job description lowers the fit");
  await alice.patch(`/jobs/${ids.jobA}`, { description: "We need 5+ years of experience building APIs with Node.js, PostgreSQL and AWS." });

  // filtering candidates by job
  const byJob = (await alice.get(`/candidates?jobId=${ids.jobA2}`)).data.candidates.map((c) => c.name).sort();
  assert.deepEqual(byJob, ["Ada Lovelace", "Grace Hopper"]);
  assert.ok((await alice.get("/candidates?jobId=none")).data.candidates.every((c) => c.applications.length === 0));

  // another company sees none of it
  assert.equal((await bob.get(`/candidates?jobId=${ids.jobA}`)).data.candidates.length, 0);
});

test("the assistant moves a single application, but asks for the board when there are several", async () => {
  const solo = (await alice.post("/candidates", { name: "Solo Applicant", email: "solo@example.com", role: "Engineer", jobId: ids.jobA })).data;
  const moved = await alice.post("/chat", { message: "Move Solo Applicant to offer" });
  assert.equal(moved.data.actionExecuted, true);
  const row = (await alice.get(`/jobs/${ids.jobA}/applications`)).data.applications.find((a) => a.candidate.id === solo.id);
  assert.equal(row.status, "offer");

  const many = await alice.post("/chat", { message: "Move Ada Lovelace to hired" });
  assert.equal(many.data.actionExecuted, false);
  assert.match(many.data.reply, /applied to 2 jobs/);
  await alice.delete(`/candidates/${solo.id}`);
});

test("removing an application and deleting a candidate clean up; a job with applications cannot be deleted", async () => {
  const jobsBefore = (await alice.get(`/jobs/${ids.jobA}`)).data.job.candidateCount;
  const blocked = await alice.delete(`/jobs/${ids.jobA}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /application/);

  const rows = (await alice.get(`/jobs/${ids.jobA2}/applications`)).data.applications;
  const graceRow = rows.find((a) => a.candidate.id === ids.cand2);
  assert.equal((await hana.delete(`/applications/${graceRow.id}`)).status, 403);
  assert.equal((await bob.delete(`/applications/${graceRow.id}`)).status, 404);
  assert.equal((await alice.delete(`/applications/${graceRow.id}`)).status, 200);
  assert.equal((await alice.delete(`/applications/${graceRow.id}`)).status, 404);
  assert.equal((await alice.get(`/jobs/${ids.jobA2}/applications`)).data.applications.some((a) => a.candidate.id === ids.cand2), false);

  // deleting a candidate removes their applications
  assert.equal((await alice.delete(`/candidates/${ids.cand1}`)).status, 200);
  assert.equal((await alice.get(`/jobs/${ids.jobA2}`)).data.job.candidateCount, 0);
  assert.ok((await alice.get(`/jobs/${ids.jobA}`)).data.job.candidateCount < jobsBefore);

  // an empty job can be deleted
  const temp = (await alice.post("/jobs", { title: "Temp" })).data.job;
  assert.equal((await alice.delete(`/jobs/${temp.id}`)).status, 200);
  assert.equal((await alice.delete(`/jobs/${temp.id}`)).status, 404);
  const audit = (await admin.get("/audit?limit=200")).data.entries.map((e) => e.action);
  for (const action of ["application.created", "application.moved", "application.removed"]) assert.ok(audit.includes(action), `missing ${action}`);
});

test("candidates have a validated phone number", async () => {
  const ok = await alice.post("/candidates", { name: "Phone Person", email: "phone@example.com", role: "R", phone: "+1 (415) 555-0123" });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.phone, "+1 (415) 555-0123");
  assert.equal((await alice.post("/candidates", { name: "Bad Phone", email: "bad@example.com", role: "R", phone: "call me maybe" })).status, 400);
  assert.equal((await alice.put(`/candidates/${ok.data.id}`, { phone: "" })).data.phone, "");
  await alice.delete(`/candidates/${ok.data.id}`);
});

// ── Resumes ───────────────────────────────────────────────────────────────────

const pdf = () => makePdf(SAMPLE_RESUME_LINES);

test("uploading a PDF returns a parsed draft profile", async () => {
  aiRequests.length = 0;
  const res = await alice.upload("/resumes", pdf(), "Jane Doe CV.pdf");
  assert.equal(res.status, 201);
  const { resume, profile, confidence, source, reused } = res.data;
  assert.equal(resume.filename, "Jane Doe CV.pdf");
  assert.equal(resume.type, "pdf");
  assert.equal(resume.candidateId, null);
  assert.equal(profile.name, "Jane Q. Doe");
  assert.equal(profile.email, "jane.doe@example.com");
  assert.equal(profile.phone, "+14155550123");
  assert.equal(profile.role, "Senior Backend Engineer");
  assert.equal(profile.experienceYears, 8);
  assert.ok(profile.skills.includes("Node.js"));
  assert.equal(confidence.name, "high");
  assert.equal(source, "rules", "everything was found by rules, so no AI call");
  assert.equal(reused, false);
  ids.resume1 = resume.id;
  assert.equal(aiRequests.length, 0, "the model was not called when rules found everything");
});

test("uploading a Word document works too, and the AI fills only the gaps from redacted text", async () => {
  aiRequests.length = 0;
  const docx = await makeDocx([
    "Pat Morgan",
    "pat.morgan@example.com",
    "+44 20 7946 0958",
    "I design and ship products people enjoy using, working closely with engineers and customers on every release.",
    "Education: BA Design"
  ]);
  const res = await alice.upload("/resumes", docx, "pat.docx");
  assert.equal(res.status, 201);
  assert.equal(res.data.resume.type, "docx");
  assert.equal(res.data.profile.name, "Pat Morgan");
  assert.equal(res.data.profile.role, "Product Designer", "role came from the AI");
  assert.equal(res.data.confidence.role, "ai");
  assert.equal(res.data.confidence.name, "high");
  assert.equal(res.data.source, "rules+ai");

  assert.equal(aiRequests.length, 1);
  const prompt = JSON.stringify(aiRequests[0].messages);
  for (const secret of ["pat.morgan@example.com", "7946 0958", "Pat", "Morgan"]) assert.equal(prompt.includes(secret), false, `${secret} reached the model`);
  ids.resume2 = res.data.resume.id;
});

test("unsafe or unsupported uploads are rejected", async () => {
  const send = (buffer, name) => alice.upload("/resumes", buffer, name);
  assert.equal((await send(Buffer.from("MZ\x90 this is an exe renamed to pdf, with enough bytes to look real"), "evil.pdf")).status, 415);
  assert.equal((await send(Buffer.from("plain text resume that is long enough to be a file"), "cv.txt")).status, 415);
  assert.equal((await send(Buffer.from("%PDF-1.4 garbage garbage garbage garbage garbage"), "broken.pdf")).status, 422);
  assert.equal((await send(makePdf(["hi"]), "empty.pdf")).status, 422, "no readable text");
  assert.equal((await alice.raw("POST", "/resumes", Buffer.alloc(0), { "content-type": "application/octet-stream" })).status, 400);
  assert.equal((await send(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(6 * 1024 * 1024)]), "huge.pdf")).status, 413);
  assert.equal((await alice.post("/resumes", { not: "a file" })).status, 400, "JSON bodies are not files");
});

test("only recruiters and admins in a company can upload; admins name the company", async () => {
  assert.equal((await hana.upload("/resumes", pdf())).status, 403);
  assert.equal((await vic.upload("/resumes", pdf())).status, 403);
  assert.equal((await nora.upload("/resumes", pdf())).status, 403);
  assert.equal((await (api.client()).upload("/resumes", pdf())).status, 401);
  assert.equal((await admin.upload("/resumes", pdf())).status, 400);
  assert.equal((await admin.upload("/resumes?companyId=nope", pdf())).status, 400);
});

test("the filename is only a display label: paths and odd characters are cleaned", async () => {
  const docx = await makeDocx(["Sam Rivera", "sam.rivera@example.com", "Senior Data Analyst", "A paragraph that is long enough to pass the minimum text check for a resume."]);
  const res = await alice.upload("/resumes", docx, '../../etc/pass"wd<script>.exe');
  assert.equal(res.status, 201);
  assert.equal(res.data.resume.type, "docx");
  assert.match(res.data.resume.filename, /^[^\\/"<>]+\.docx$/);
  assert.equal(res.data.resume.filename.includes(".."), false);
  await alice.delete(`/resumes/${res.data.resume.id}`);
});

test("files are stored under random names, outside the client's control", async () => {
  const files = fs.readdirSync(storage);
  assert.ok(files.length >= 2);
  for (const file of files) assert.match(file, /^[0-9a-f-]{36}\.(pdf|docx)$/);
  for (const file of files) assert.equal((fs.statSync(path.join(storage, file)).mode & 0o077), 0, "owner-only permissions");
});

test("uploading the same file again reuses the first one instead of storing it twice", async () => {
  const before = fs.readdirSync(storage).length;
  const again = await alice.upload("/resumes", pdf(), "renamed.pdf");
  assert.equal(again.status, 200);
  assert.equal(again.data.reused, true);
  assert.equal(again.data.resume.id, ids.resume1);
  assert.equal(fs.readdirSync(storage).length, before);
});

test("resumes are private to the company: no reading, downloading or discarding by others", async () => {
  assert.equal((await bob.get(`/resumes/${ids.resume1}`)).status, 404);
  assert.equal((await bob.get(`/resumes/${ids.resume1}/file`)).status, 404);
  assert.equal((await bob.delete(`/resumes/${ids.resume1}`)).status, 404);
  assert.equal((await nora.get(`/resumes/${ids.resume1}`)).status, 404);
  assert.equal((await hana.get(`/resumes/${ids.resume1}`)).status, 200, "the company can read it");
  assert.equal((await hana.delete(`/resumes/${ids.resume1}`)).status, 403);
  assert.equal((await admin.get(`/resumes/${ids.resume1}`)).status, 200);
  // the same bytes uploaded by another company are a separate resume
  const other = await bob.upload("/resumes", pdf(), "jane.pdf");
  assert.equal(other.status, 201);
  assert.notEqual(other.data.resume.id, ids.resume1);
  ids.resumeB = other.data.resume.id;
});

test("download is always an attachment with a fixed content type, and is audited", async () => {
  const res = await alice.raw("GET", `/resumes/${ids.resume1}/file`);
  assert.equal(res.status, 200);
  assert.equal(res.res.headers.get("content-type"), "application/pdf");
  assert.match(res.res.headers.get("content-disposition"), /^attachment;/);
  assert.equal(res.res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.res.headers.get("cache-control"), /no-store/);
  assert.ok(res.bytes.equals(pdf()), "bytes are unchanged");
  const doc = await alice.raw("GET", `/resumes/${ids.resume2}/file`);
  assert.equal(doc.res.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok((await admin.get("/audit?action=resume.downloaded")).data.entries.length >= 2);
  assert.equal((await alice.get("/resumes/nope")).status, 404);
  assert.equal((await alice.get("/resumes/nope/file")).status, 404);
});

test("creating a candidate from a resume links it; duplicates and cross-company use are refused", async () => {
  // existing candidate with the same email in the company is reported on upload
  await alice.post("/candidates", { name: "Jane Existing", email: "jane.doe@example.com", role: "Engineer" });
  const second = await alice.upload("/resumes", makePdf([...SAMPLE_RESUME_LINES, "Languages: English"]), "jane2.pdf");
  assert.equal(second.status, 201);
  assert.equal(second.data.existingCandidate.name, "Jane Existing");
  assert.ok(second.data.warnings.some((w) => /already exists/.test(w)));
  await alice.delete(`/resumes/${second.data.resume.id}`);

  assert.equal((await alice.post("/candidates", { name: "J", email: "j@example.com", role: "R", resumeId: ids.resumeB })).status, 400, "resume of another company");
  assert.equal((await alice.post("/candidates", { name: "J", email: "j@example.com", role: "R", resumeId: "nope" })).status, 400);

  const created = await alice.post("/candidates", {
    name: "Jane Q. Doe", email: "jane.q@example.com", role: "Senior Backend Engineer", resumeId: ids.resume1, jobId: ids.jobA
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.resumeId, ids.resume1);
  ids.cand3 = created.data.id;
  assert.equal((await alice.get(`/resumes/${ids.resume1}`)).data.resume.candidateId, ids.cand3);

  // a resume belongs to one candidate
  assert.equal((await alice.post("/candidates", { name: "K", email: "k@example.com", role: "R", resumeId: ids.resume1 })).status, 400);
  const reuse = await alice.upload("/resumes", pdf(), "again.pdf");
  assert.equal(reuse.data.alreadyAttachedTo.name, "Jane Q. Doe");

  // a linked resume cannot be discarded on its own; an unlinked one can
  assert.equal((await alice.delete(`/resumes/${ids.resume1}`)).status, 409);
  assert.equal((await alice.delete(`/resumes/${ids.resume2}`)).status, 200);
  assert.equal((await alice.get(`/resumes/${ids.resume2}`)).status, 404);
});

test("attaching a resume to an existing candidate works, and replacing removes the old file", async () => {
  const cv = await alice.upload("/resumes", await makeDocx(["Lee Park", "lee.park@example.com", "QA Engineer", "A paragraph that is long enough to pass the minimum text check for a resume."]), "lee.docx");
  const lee = (await alice.post("/candidates", { name: "Lee Park", email: "lee.park@example.com", role: "QA Engineer" })).data;
  const attach = await alice.put(`/candidates/${lee.id}`, { resumeId: cv.data.resume.id });
  assert.equal(attach.status, 200);
  assert.equal(attach.data.resumeId, cv.data.resume.id);

  const before = fs.readdirSync(storage).length;
  const cv2 = await alice.upload("/resumes", await makeDocx(["Lee Park", "lee.park@example.com", "Senior QA Engineer", "Another paragraph that is long enough to pass the minimum text check."]), "lee2.docx");
  assert.equal((await alice.put(`/candidates/${lee.id}`, { resumeId: cv2.data.resume.id })).status, 200);
  assert.equal(fs.readdirSync(storage).length, before, "one new file stored, the replaced one removed");
  assert.equal((await alice.get(`/resumes/${cv.data.resume.id}`)).status, 404);
  ids.lee = lee.id;
  ids.leeResume = cv2.data.resume.id;
});

test("deleting a candidate deletes its resume file and record", async () => {
  const filesBefore = fs.readdirSync(storage).length;
  assert.equal((await alice.delete(`/candidates/${ids.lee}`)).status, 200);
  assert.equal((await alice.get(`/resumes/${ids.leeResume}`)).status, 404);
  assert.equal(fs.readdirSync(storage).length, filesBefore - 1);
});

test("fit score per job: uses the profile, the resume and each job's description; respects company and role access", async () => {
  const cand = (await alice.post("/candidates", { name: "Fit Person", email: "fit@example.com", role: "Software Developer", experienceYears: 2 })).data;
  assert.deepEqual((await alice.get(`/candidates/${cand.id}/applications`)).data.applications, [], "no job, no fit");

  const jd = (await alice.post("/jobs", {
    title: "Backend Engineer", location: "Remote",
    description: "We need 5+ years of experience building APIs with Node.js, PostgreSQL and AWS. Docker is a plus."
  })).data.job;
  assert.equal((await alice.post(`/candidates/${cand.id}/applications`, { jobId: jd.id })).status, 201);

  aiRequests.length = 0;
  const first = (await alice.get(`/candidates/${cand.id}/applications`)).data.applications[0];
  assert.equal(first.job.title, "Backend Engineer");
  assert.equal(first.fit.breakdown.length, 5);
  assert.deepEqual(first.fit.matchedSkills, []);
  assert.deepEqual(first.fit.missingSkills.sort(), ["AWS", "Docker", "Node.js", "PostgreSQL"]);
  assert.equal(first.fit.requiredYears, 5);
  assert.equal(first.fit.candidateYears, 2);
  assert.equal(first.fit.usedResume, false);
  assert.equal(first.fit.explanationSource, "ai", "the fake model reworded the explanation");
  const prompt = JSON.stringify(aiRequests.at(-1)?.messages || []);
  for (const secret of ["Fit Person", "fit@example.com"]) assert.equal(prompt.includes(secret), false, `${secret} reached the model`);

  // adding skills raises the score
  assert.equal((await alice.put(`/candidates/${cand.id}`, { skills: ["Node.js", "AWS"], experienceYears: 6 })).status, 200);
  const better = (await alice.get(`/candidates/${cand.id}/applications`)).data.applications[0].fit;
  assert.deepEqual(better.matchedSkills.sort(), ["AWS", "Node.js"]);
  assert.ok(better.score > first.fit.score + 20, `${better.score} vs ${first.fit.score}`);

  // attaching a resume with more skills raises it again
  const cv = await alice.upload("/resumes", await makeDocx([
    "Fit Person", "fit@example.com", "Backend Engineer",
    "Skills: Node.js, AWS, PostgreSQL, Docker. A paragraph that is long enough to pass the minimum text check."
  ]), "fit.docx");
  assert.equal(cv.status, 201);
  assert.equal((await alice.put(`/candidates/${cand.id}`, { resumeId: cv.data.resume.id })).status, 200);
  const withResume = (await alice.get(`/candidates/${cand.id}/applications`)).data.applications[0].fit;
  assert.equal(withResume.usedResume, true);
  assert.deepEqual(withResume.matchedSkills.sort(), ["AWS", "Docker", "Node.js", "PostgreSQL"]);
  assert.ok(withResume.score > better.score);

  // read-only and hiring-manager users in the company can read it; other companies cannot
  assert.equal((await hana.get(`/candidates/${cand.id}/applications`)).data.applications.length, 1);
  assert.equal((await vic.get(`/candidates/${cand.id}/applications`)).status, 200);
  assert.equal((await admin.get(`/candidates/${cand.id}/applications`)).status, 200);
  assert.equal((await bob.get(`/candidates/${cand.id}/applications`)).status, 404);
  assert.equal((await api.client().get(`/candidates/${cand.id}/applications`)).status, 401);

  // the job description decides the score: one with no skills warns
  await alice.patch(`/jobs/${jd.id}`, { description: "Looking for someone who enjoys cooking." });
  const changed = (await alice.get(`/candidates/${cand.id}/applications`)).data.applications[0].fit;
  assert.ok(changed.warnings.some((w) => /No known skills/.test(w)));
  assert.notEqual(changed.score, withResume.score);

  await alice.delete(`/candidates/${cand.id}`);
});

test("uploads are rate limited per user", async () => {
  const limited = await startApi({ UPLOAD_RATE_LIMIT: "3", RESUME_STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "acmp-rl-")), MONGODB_URI: "" });
  try {
    const owner = limited.client();
    await owner.post("/auth/signup", { name: "Root", email: "root@example.com", password });
    await owner.post("/auth/signin", { email: "root@example.com", password });
    const company = (await owner.post("/companies", { name: "RL Co" })).data.company.id;
    let last;
    for (let i = 0; i < 5; i += 1) last = (await owner.upload(`/resumes?companyId=${company}`, Buffer.from("not a resume"))).status;
    assert.equal(last, 429);
  } finally {
    await limited.stop();
  }
});

test("audit records uploads, jobs and links without file contents or personal data", async () => {
  const entries = (await admin.get("/audit?limit=200")).data.entries;
  const actions = new Set(entries.map((e) => e.action));
  for (const expected of ["job.created", "job.updated", "job.deleted", "resume.uploaded", "resume.downloaded", "resume.deleted", "candidate.created"]) {
    assert.ok(actions.has(expected), `missing ${expected}`);
  }
  const text = JSON.stringify(entries);
  for (const secret of ["jane.doe@example.com", "+14155550123", "Jane Q. Doe CV", password]) {
    assert.equal(text.includes(secret), false, `${secret} must not be in the audit log`);
  }
});
