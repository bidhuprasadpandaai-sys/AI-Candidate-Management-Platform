import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import CandidateDetailSidebar from "../components/CandidateDetailSidebar.vue";
import { useAuthStore } from "../stores/auth";
import { useCandidateStore } from "../stores/candidates";

const fitFor = (extra = {}) => ({
  score: 82,
  level: "strong",
  label: "Strong fit",
  explanation: 'Strong fit for "Senior Engineer". Has 2 of 3 required skills (Node.js, AWS); missing Docker.',
  explanationSource: "rules",
  usedResume: true,
  breakdown: [
    { key: "skills", label: "Skills", weight: 45, score: 67, detail: "2 of 3 skills asked for" },
    { key: "experience", label: "Experience", weight: 25, score: 100, detail: "8 years of experience against 5 asked for" },
    { key: "title", label: "Role match", weight: 15, score: 100, detail: "3 of 3 words of the job title match the candidate's role" },
    { key: "location", label: "Location", weight: 5, score: 100, detail: "The job is remote" },
    { key: "profile", label: "Profile completeness", weight: 10, score: 70, detail: "Missing: phone number" }
  ],
  matchedSkills: ["Node.js", "AWS"],
  missingSkills: ["Docker"],
  extraSkills: [],
  warnings: ["The job has no description, so skills and experience cannot be compared."],
  ...extra
});
const application = (id, title, fit = {}, status = "screening") => ({
  id,
  status,
  stage: `${status} stage`,
  job: { id: `job-${id}`, title, status: "open" },
  fit: fitFor(fit)
});
let applicationsResponse = [];
let documentsResponse = [];

const SidebarStub = { template: '<div class="sidebar-stub"><slot name="header" /><slot /></div>' };

const candidate = (extra = {}) => ({
  id: "c1",
  name: "Ada Lovelace",
  role: "Engineer",
  status: "screening",
  score: 90,
  experienceYears: 7,
  location: "London",
  skills: ["math"],
  notes: [],
  interviews: [],
  ownerId: "owner-1",
  ownerName: "Olivia Owner",
  companyId: "c1",
  companyName: "Acme Corp",
  ...extra
});

async function open(user, cand = candidate()) {
  api.get.mockImplementation(async (url) => {
    if (url === "/companies") return { data: { companies: [{ id: "c1", name: "Acme Corp" }] } };
    if (url === "/users") return { data: { users: [] } };
    if (/\/candidates\/[^/]+\/applications$/.test(url)) return { data: { applications: applicationsResponse } };
    if (/\/candidates\/[^/]+\/documents$/.test(url)) return { data: { documents: documentsResponse } };
    if (url === "/jobs") return { data: { jobs: [{ id: "j1", companyId: "c1", title: "Senior Engineer", status: "open" }, { id: "j2", companyId: "c1", title: "Old Job", status: "closed" }, { id: "j3", companyId: "c2", title: "Other Co", status: "open" }, { id: "j4", companyId: "c1", title: "Expired Job", status: "open", isExpired: true }, { id: "j5", companyId: "c1", title: "Full Job", status: "open", isFull: true }] } };
    if (url.endsWith("/audit")) return { data: { entries: [{ id: "e1", summary: "Updated Ada Lovelace: status", createdAt: "2026-10-15T10:00:00.000Z", source: "user" }] } };
    throw new Error(`unexpected GET ${url}`);
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = user;
  const store = useCandidateStore();
  store.candidates = [cand];
  const wrapper = mount(CandidateDetailSidebar, { global: { plugins: [pinia, PrimeVue], stubs: { Sidebar: SidebarStub } } });
  store.selectCandidate(cand.id);
  await flushPromises();
  return { wrapper, store };
}

const buttons = (wrapper) => wrapper.findAll("button").map((b) => b.text());

describe("CandidateDetailSidebar role gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applicationsResponse = [];
    documentsResponse = [];
  });

  it("shows owner and company names and the activity feed", async () => {
    const { wrapper } = await open({ id: "owner-1", accessRole: "recruiter", companyId: "c1" });
    expect(wrapper.find('[data-test="owner-name"]').text()).toBe("Olivia Owner");
    expect(wrapper.find('[data-test="company-name"]').text()).toBe("Acme Corp");
    expect(wrapper.text()).toContain("Updated Ada Lovelace: status");
    expect(api.get).toHaveBeenCalledWith("/candidates/c1/audit", { params: { limit: 20 } });
  });

  it("owner recruiter can delete, annotate and edit status", async () => {
    const { wrapper } = await open({ id: "owner-1", accessRole: "recruiter", companyId: "c1" });
    expect(buttons(wrapper)).toContain("Delete Candidate");
    expect(buttons(wrapper)).toContain("Log Note");
    expect(buttons(wrapper).some((t) => t.includes("Schedule Round"))).toBe(true);
    expect(wrapper.find(".status-dropdown").classes()).not.toContain("p-disabled");
  });

  it("colleague recruiter in the same company can edit but not delete", async () => {
    const { wrapper } = await open({ id: "mate", accessRole: "recruiter", companyId: "c1" });
    expect(buttons(wrapper)).not.toContain("Delete Candidate");
    expect(buttons(wrapper)).toContain("Log Note");
    expect(wrapper.find(".status-dropdown").classes()).not.toContain("p-disabled");
  });

  it("hiring manager can add notes but cannot change status or delete", async () => {
    const { wrapper } = await open({ id: "hm", accessRole: "hiring_manager", companyId: "c1" });
    expect(buttons(wrapper)).toContain("Log Note");
    expect(buttons(wrapper)).not.toContain("Delete Candidate");
    expect(wrapper.find(".status-dropdown").classes()).toContain("p-disabled");
    expect(wrapper.text()).not.toContain("Set company");
  });

  it("read-only user sees everything but has no write controls", async () => {
    const { wrapper } = await open({ id: "v", accessRole: "viewer", companyId: "c1" });
    expect(wrapper.text()).toContain("Ada Lovelace");
    const labels = buttons(wrapper);
    expect(labels).not.toContain("Log Note");
    expect(labels).not.toContain("Delete Candidate");
    expect(labels.some((t) => t.includes("Schedule Round"))).toBe(false);
    expect(wrapper.find(".add-note-box").exists()).toBe(false);
    expect(wrapper.find(".status-dropdown").classes()).toContain("p-disabled");
  });

  it("recruiter can claim an unassigned candidate with Assign to me", async () => {
    const pool = candidate({ ownerId: null, ownerName: null });
    api.put.mockResolvedValue({ data: {} });
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, pool);
    expect(wrapper.find('[data-test="owner-name"]').text()).toBe("Unassigned");
    const claim = wrapper.findAll("button").find((b) => b.text().includes("Assign to me"));
    expect(claim).toBeTruthy();
    api.get.mockImplementation(async (url) => (url === "/companies" ? { data: { companies: [] } } : url.endsWith("/audit") ? { data: { entries: [] } } : { data: { metrics: {}, candidates: [], users: [] } }));
    await claim.trigger("click");
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("/candidates/c1/assignment", { ownerId: "rita" });
  });

  it("admin can set the company and owner of a candidate", async () => {
    api.put.mockResolvedValue({ data: {} });
    api.get.mockImplementation(async (url) => {
      if (url === "/companies") return { data: { companies: [{ id: "c1", name: "Acme Corp" }, { id: "c2", name: "Globex" }] } };
      if (url === "/users") return { data: { users: [{ id: "u1", name: "Ann", accessRole: "recruiter", companyId: "c1", isActive: true }, { id: "u2", name: "Zed", accessRole: "recruiter", companyId: "c2", isActive: true }] } };
      if (url.endsWith("/audit")) return { data: { entries: [] } };
      return { data: { metrics: {}, candidates: [] } };
    });
    const { wrapper } = await open({ id: "root", accessRole: "admin" }, candidate());
    expect(wrapper.find('[aria-label="Company"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Owner"]').exists()).toBe(true);
    const setCompany = wrapper.findAll("button").find((b) => b.text() === "Set company");
    const setOwner = wrapper.findAll("button").find((b) => b.text() === "Set owner");
    expect(setCompany && setOwner).toBeTruthy();
    await setOwner.trigger("click");
    await flushPromises();
    expect(api.put).toHaveBeenCalledWith("/candidates/c1/assignment", { ownerId: "owner-1" });
  });

  it("a user from another company gets no controls for the candidate", async () => {
    const { wrapper } = await open({ id: "bob", accessRole: "recruiter", companyId: "c2" });
    const labels = buttons(wrapper);
    expect(labels).not.toContain("Delete Candidate");
    expect(labels).not.toContain("Log Note");
    expect(wrapper.find(".status-dropdown").classes()).toContain("p-disabled");
  });

  it("shows the server's message when ownership cannot be changed", async () => {
    const pool = candidate({ ownerId: null, ownerName: null });
    api.put.mockRejectedValue({ response: { data: { message: "You can only assign candidates to yourself" } } });
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, pool);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await wrapper.findAll("button").find((b) => b.text().includes("Assign to me")).trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("You can only assign candidates to yourself");
  });

  it("shows the resume state and download for people who can see the candidate", async () => {
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate({ resumeId: "r1", phone: "+14155550123" }));
    expect(wrapper.find('[data-test="resume-state"]').text()).toBe("On file");
    expect(wrapper.text()).toContain("+14155550123");
    expect(buttons(wrapper)).toContain("Download resume");
  });

  it("read-only users see the resume but cannot attach files or change jobs", async () => {
    applicationsResponse = [application("a1", "Senior Engineer")];
    const { wrapper } = await open({ id: "v", accessRole: "viewer", companyId: "c1" }, candidate({ resumeId: "r1" }));
    expect(buttons(wrapper)).toContain("Download resume");
    expect(wrapper.find('input[aria-label="Attach resume"]').exists()).toBe(false);
    expect(wrapper.find('select[aria-label="Stage for Senior Engineer"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="app-stage"]').text()).toBe("screening");
    expect(buttons(wrapper)).not.toContain("Add to job");
  });

  it("offers to attach a resume when there is none, and attaches it after upload", async () => {
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate({ resumeId: null }));
    expect(wrapper.find('[data-test="resume-state"]').text()).toBe("None");
    expect(buttons(wrapper)).not.toContain("Download resume");
    const input = wrapper.find('input[aria-label="Attach resume"]');
    expect(input.exists()).toBe(true);

    api.post.mockResolvedValue({ data: { resume: { id: "r9" }, alreadyAttachedTo: null } });
    api.put.mockResolvedValue({ data: {} });
    api.get.mockImplementation(async (url) => (url.endsWith("/audit") ? { data: { entries: [] } } : { data: { metrics: {}, candidates: [], jobs: [], companies: [] } }));
    const file = new File([new Uint8Array(10)], "cv.docx");
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/resumes", file, expect.objectContaining({ headers: expect.objectContaining({ "X-Filename": "cv.docx" }) }));
    expect(api.put).toHaveBeenCalledWith("/candidates/c1", { resumeId: "r9" });
  });

  it("refuses wrong file types when attaching without calling the API", async () => {
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate({ resumeId: null }));
    const input = wrapper.find('input[aria-label="Attach resume"]');
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "cv.txt")], configurable: true });
    await input.trigger("change");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Choose a PDF or Word (.docx) file up to 5 MB.");
  });

  it("shows profile completion with what is still missing", async () => {
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate({ phone: "", resumeId: null, summary: "", skills: ["math"] }));
    const meter = wrapper.find('[aria-label="Profile completion"] [data-test="profile-score"]');
    expect(meter.exists()).toBe(true);
    const items = wrapper.find('[data-test="missing-list"]').text();
    for (const expected of ["Add phone number", "Add resume on file", "Add summary", "Add skills (3 or more)"]) expect(items).toContain(expected);
  });

  it("says everything is filled in for a complete profile", async () => {
    const full = candidate({ email: "ada@example.com", phone: "+14155550123", resumeId: "r1", summary: "Backend engineer who builds reliable APIs for fast growing teams.", skills: ["a", "b", "c"], experienceYears: 5 });
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, full);
    expect(wrapper.text()).toContain("Everything we ask for is filled in.");
    expect(wrapper.find('[data-test="missing-list"]').exists()).toBe(false);
  });

  it("asks to add a job when there is none, instead of showing a fit score", async () => {
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    expect(wrapper.find('[data-test="fit-no-job"]').text()).toContain("Add this candidate to a job");
    expect(wrapper.find('[data-test="fit-score"]').exists()).toBe(false);
    expect(api.get).toHaveBeenCalledWith("/candidates/c1/applications");
    expect(wrapper.find('[data-test="stage-hint"]').exists()).toBe(false);
  });

  it("shows one entry per job with its own fit score, stage and the best fit first", async () => {
    applicationsResponse = [
      application("a1", "Senior Engineer", { score: 82 }, "interview"),
      application("a2", "Product Designer", { score: 31, level: "weak", label: "Weak fit" })
    ];
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    const items = wrapper.findAll('[data-test="application"]');
    expect(items).toHaveLength(2);
    expect(items[0].find('[data-test="app-job"]').text()).toBe("Senior Engineer");
    expect(items[0].find('[data-test="fit-score"]').text()).toBe("82");
    expect(items[0].find(".fit-badge").classes()).toContain("fit-strong");
    expect(items[0].find("select.app-stage").element.value).toBe("interview");
    expect(items[1].find('[data-test="fit-score"]').text()).toBe("31");
    expect(items[1].find(".fit-badge").classes()).toContain("fit-weak");
    expect(items[1].find("select.app-stage").element.value).toBe("screening");
  });

  it("the overall status is read-only while the candidate has job applications", async () => {
    applicationsResponse = [application("a1", "Senior Engineer")];
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    expect(wrapper.find(".status-dropdown").classes()).toContain("p-disabled");
    expect(wrapper.find('[data-test="stage-hint"]').text()).toContain("set per job");
  });

  it("expands the best job to show the explanation, factors, matched and missing skills and warnings", async () => {
    applicationsResponse = [application("a1", "Senior Engineer"), application("a2", "Other Job", { score: 40, level: "partial", label: "Partial fit" })];
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    const details = wrapper.findAll('[data-test="fit-details"]');
    expect(details).toHaveLength(1);
    expect(details[0].classes()).toContain("fit-strong");
    expect(details[0].find('[data-test="fit-explanation"]').text()).toContain("Has 2 of 3 required skills");
    expect(details[0].find('[data-test="fit-explanation"]').text()).not.toContain("worded by AI");
    const factors = details[0].findAll(".fit-factors li");
    expect(factors).toHaveLength(5);
    expect(factors[0].text()).toContain("(45%)");
    expect(factors[0].find('[role="progressbar"]').attributes("aria-valuenow")).toBe("67");
    expect(details[0].findAll(".fit-chip-match").map((c) => c.text())).toEqual(["Node.js", "AWS"]);
    expect(details[0].findAll(".fit-chip-missing").map((c) => c.text())).toEqual(["Docker"]);
    expect(details[0].find(".fit-warnings").text()).toContain("The job has no description");
    expect(details[0].text()).toContain("Resume included");

    // opening the other job shows its own details
    await wrapper.findAll(".app-toggle")[1].trigger("click");
    expect(wrapper.find('[data-test="fit-details"]').classes()).toContain("fit-partial");
  });

  it("marks an AI-worded explanation", async () => {
    applicationsResponse = [application("a1", "Senior Engineer", { explanationSource: "ai", explanation: "A solid match; only Docker is missing." })];
    const { wrapper } = await open({ id: "v", accessRole: "viewer", companyId: "c1" }, candidate());
    expect(wrapper.find('[data-test="fit-explanation"]').text()).toContain("worded by AI");
  });

  it("moves one application to another stage", async () => {
    applicationsResponse = [application("a1", "Senior Engineer"), application("a2", "Other Job", { score: 40, level: "partial", label: "Partial fit" })];
    api.patch.mockResolvedValue({ data: {} });
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    await wrapper.find('select[aria-label="Stage for Other Job"]').setValue("offer");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/applications/a2", { status: "offer" });
  });

  it("adds the candidate to another open job of the same company", async () => {
    applicationsResponse = [application("a1", "Senior Engineer")];
    api.post.mockResolvedValue({ data: {} });
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    const addButton = () => wrapper.findAll("button").find((b) => b.text() === "Add to job");
    expect(addButton().attributes("disabled")).toBeDefined();

    const dropdown = wrapper.findAllComponents({ name: "Dropdown" }).find((d) => d.props("placeholder") === "Add to a job");
    expect(dropdown).toBeTruthy();
    // only open jobs of the candidate's company that they have not applied to yet are offered
    expect(dropdown.props("options").map((o) => o.value)).toEqual(["j1"]);
    dropdown.vm.$emit("update:modelValue", "j1");
    await flushPromises();
    await addButton().trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/candidates/c1/applications", { jobId: "j1" });
  });

  it("removes an application after confirmation", async () => {
    applicationsResponse = [application("a1", "Senior Engineer")];
    api.delete.mockResolvedValue({ data: {} });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { wrapper } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    await wrapper.find('[aria-label="Remove from Senior Engineer"]').trigger("click");
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/applications/a1");
  });

  it("shows a friendly message when the fit cannot be calculated", async () => {
    const { wrapper, store } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    api.get.mockImplementation(async (url) => { if (url.endsWith("/applications")) throw new Error("boom"); return { data: { entries: [], companies: [], jobs: [], users: [] } }; });
    store.candidates[0].skills = ["new skill"]; // anything the score depends on triggers a recalculation
    await flushPromises();
    expect(wrapper.text()).toContain("The job fit could not be calculated.");
  });

  it("recalculates when something the scores depend on changes", async () => {
    const { store } = await open({ id: "rita", accessRole: "recruiter", companyId: "c1" }, candidate());
    const calls = () => api.get.mock.calls.filter(([url]) => url.endsWith("/applications")).length;
    const before = calls();
    store.candidates[0].skills = ["a", "b"];
    await flushPromises();
    expect(calls()).toBe(before + 1);
  });
});


describe("CandidateDetailSidebar tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applicationsResponse = [];
    documentsResponse = [];
    document.body.innerHTML = "";
  });

  const rita = { id: "rita", accessRole: "recruiter", companyId: "c1" };
  const tabButton = (wrapper, name) => wrapper.findAll('[role="tab"]').find((t) => t.text().includes(name));
  const visible = (wrapper, id) => wrapper.find(`#panel-${id}`).element.style.display !== "none";

  it("shows one section at a time, starting with Overview", async () => {
    const { wrapper } = await open(rita);
    expect(wrapper.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, "").trim())).toEqual(["Overview", "Jobs", "Documents", "Notes", "Activity"]);
    expect(visible(wrapper, "overview")).toBe(true);
    for (const id of ["jobs", "documents", "notes", "activity"]) expect(visible(wrapper, id)).toBe(false);
    await tabButton(wrapper, "Documents").trigger("click");
    expect(visible(wrapper, "documents")).toBe(true);
    expect(visible(wrapper, "overview")).toBe(false);
    expect(tabButton(wrapper, "Documents").attributes("aria-selected")).toBe("true");
  });

  it("shows a count on Jobs and a red alert on Documents when a document is expired", async () => {
    applicationsResponse = [application("a1", "Senior Engineer"), application("a2", "Other Job")];
    documentsResponse = [{ id: "d1", title: "Old ID", category: "id_proof", filename: "id.png", type: "png", size: 2048, expiresAt: "2020-01-01", status: "expired", daysLeft: -100, isExpired: true }];
    const { wrapper } = await open(rita);
    await flushPromises();
    expect(tabButton(wrapper, "Jobs").text()).toContain("2");
    const docs = tabButton(wrapper, "Documents");
    expect(docs.find(".tab-badge.alert").exists()).toBe(true);
  });

  it("goes back to Overview when another candidate is opened", async () => {
    const { wrapper, store } = await open(rita);
    await tabButton(wrapper, "Notes").trigger("click");
    store.candidates.push(candidate({ id: "c2", name: "Grace" }));
    store.selectCandidate("c2");
    await flushPromises();
    expect(visible(wrapper, "overview")).toBe(true);
  });
});

describe("attaching a resume to an existing candidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applicationsResponse = [];
    documentsResponse = [];
    document.body.innerHTML = "";
  });

  const rita = { id: "rita", accessRole: "recruiter", companyId: "c1" };
  const parsed = { name: "Someone Else", email: "other@example.com", phone: "+14155550123", role: "Senior Engineer", location: "London", skills: ["Math", "AWS"], experienceYears: 12, summary: "Builds things." };

  async function attach(cand, profile = parsed) {
    const ctx = await open(rita, cand);
    api.post.mockResolvedValue({ data: { resume: { id: "r9" }, profile, alreadyAttachedTo: null } });
    api.put.mockResolvedValue({ data: { ...cand, resumeId: "r9" } });
    const input = ctx.wrapper.find('input[aria-label="Attach resume"]');
    Object.defineProperty(input.element, "files", { value: [new File([new Uint8Array(10)], "cv.docx")], configurable: true });
    await input.trigger("change");
    await flushPromises();
    return ctx;
  }
  const body = () => document.body;
  const pressed = (text) => [...body().querySelectorAll("button")].filter((b) => b.textContent.trim().includes(text)).at(-1);

  it("stores the file without changing the profile, then asks before updating anything", async () => {
    await attach(candidate({ resumeId: null }));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith("/candidates/c1", { resumeId: "r9" });
    expect(body().textContent).toContain("Update the profile from this resume?");
  });

  it("lists only what differs and never offers the name or email", async () => {
    await attach(candidate({ resumeId: null, role: "Senior Engineer", location: "London", skills: ["math", "aws"] }));
    const text = body().textContent;
    expect(text).toContain("Phone");
    expect(text).toContain("Years of experience");
    expect(text).toContain("Summary");
    expect(text).not.toContain("Someone Else");
    expect(text).not.toContain("other@example.com");
    expect(body().querySelector('input[aria-label="Update Role"]')).toBeNull(); // same role
    expect(body().querySelector('input[aria-label="Update Skills"]')).toBeNull(); // same skills, any case or order
  });

  it("Keep current profile changes nothing", async () => {
    await attach(candidate({ resumeId: null }));
    pressed("Keep current profile").click();
    await flushPromises();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(body().textContent).not.toContain("Update the profile from this resume?");
  });

  it("Update selected sends only the ticked fields, and never the name", async () => {
    await attach(candidate({ resumeId: null }));
    body().querySelector('input[aria-label="Update Summary"]').click();
    await flushPromises();
    pressed("Update selected").click();
    await flushPromises();
    const [, payload] = api.put.mock.calls.at(-1);
    expect(payload).toMatchObject({ phone: "+14155550123", role: "Senior Engineer", experienceYears: 12, skills: ["Math", "AWS"] });
    expect(payload).not.toHaveProperty("location"); // same as the profile
    expect(payload).not.toHaveProperty("summary");
    expect(payload).not.toHaveProperty("name");
    expect(payload).not.toHaveProperty("email");
  });

  it("does not ask when the resume adds nothing new", async () => {
    await attach(candidate({ resumeId: null }), { name: "Ada", email: "ada@example.com", skills: [], role: "Engineer" });
    expect(body().textContent).not.toContain("Update the profile from this resume?");
  });

  it("says so when the file is already this candidate's resume", async () => {
    const ctx = await open(rita, candidate({ resumeId: "r1" }));
    api.post.mockResolvedValue({ data: { resume: { id: "r1" }, profile: parsed, alreadyAttachedTo: { id: "c1", name: "Ada Lovelace" } } });
    const input = ctx.wrapper.find('input[aria-label="Attach resume"]');
    Object.defineProperty(input.element, "files", { value: [new File([new Uint8Array(10)], "cv.docx")], configurable: true });
    await input.trigger("change");
    await flushPromises();
    expect(ctx.wrapper.text()).toContain("already this candidate's resume");
    expect(api.put).not.toHaveBeenCalled();
  });
});
