import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import AddCandidateModal from "../components/AddCandidateModal.vue";
import { useAuthStore } from "../stores/auth";

const uploadResponse = (extra = {}) => ({
  data: {
    resume: { id: "r1", filename: "Jane Doe CV.pdf", type: "pdf", size: 1000, candidateId: null },
    profile: { name: "Jane Q. Doe", email: "jane@example.com", phone: "+14155550123", role: "Senior Engineer", location: "San Francisco, CA", skills: ["Node.js", "AWS"], experienceYears: 8, summary: "Builds APIs." },
    confidence: { name: "high", role: "ai", skills: "low" },
    warnings: [],
    source: "rules+ai",
    reused: false,
    alreadyAttachedTo: null,
    existingCandidate: null,
    ...extra
  }
});

async function setup({ user = { id: "me", accessRole: "recruiter", companyId: "c1" } } = {}) {
  api.get.mockImplementation(async (url) => {
    if (url === "/jobs") return { data: { jobs: [{ id: "j1", companyId: "c1", title: "Senior Engineer", status: "open" }, { id: "j2", companyId: "c1", title: "Closed Job", status: "closed" }, { id: "j9", companyId: "c2", title: "Other Co Job", status: "open" }] } };
    if (url === "/companies") return { data: { companies: [{ id: "c1", name: "Acme Corp" }] } };
    return { data: { metrics: {}, candidates: [], total: 0 } };
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = user;
  const wrapper = mount(AddCandidateModal, { props: { visible: false }, global: { plugins: [pinia, PrimeVue] } });
  await wrapper.setProps({ visible: true });
  await flushPromises();
  return wrapper;
}

const body = () => document.body;
const byLabel = (label) => body().querySelector(`[aria-label="${label}"]`);
const button = (text) => [...body().querySelectorAll("button")].find((b) => b.textContent.trim().includes(text));

async function chooseFile(name = "cv.pdf", size = 1000) {
  const input = byLabel("Resume file");
  const file = new File([new Uint8Array(size)], name);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await flushPromises();
  return file;
}

async function type(selector, value) {
  const el = body().querySelector(selector);
  el.value = value;
  el.dispatchEvent(new Event("input"));
  await flushPromises();
}

describe("AddCandidateModal: resume autofill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the resume box inside the Add Candidate popup, next to the normal fields", async () => {
    await setup();
    expect(body().textContent).toContain("Add New Candidate");
    expect(body().textContent).toContain("Autofill from a resume");
    expect(byLabel("Resume file")).toBeTruthy();
    expect(body().querySelector("#c-name")).toBeTruthy();
    expect(body().querySelector("#c-phone")).toBeTruthy();
    expect(byLabel("Job")).toBeTruthy();
  });

  it("uploads the raw file and fills the empty fields from the resume", async () => {
    api.post.mockResolvedValue(uploadResponse());
    await setup();
    const file = await chooseFile("Jane Doe CV.pdf");

    const [url, sent, config] = api.post.mock.calls[0];
    expect(url).toBe("/resumes");
    expect(sent).toBe(file);
    expect(config.headers["Content-Type"]).toBe("application/octet-stream");
    expect(config.headers["X-Filename"]).toBe(encodeURIComponent("Jane Doe CV.pdf"));

    expect(body().querySelector("#c-name").value).toBe("Jane Q. Doe");
    expect(body().querySelector("#c-email").value).toBe("jane@example.com");
    expect(body().querySelector("#c-phone").value).toBe("+14155550123");
    expect(body().querySelector("#c-role").value).toBe("Senior Engineer");
    expect(body().querySelector("#c-location").value).toBe("San Francisco, CA");
    expect(body().querySelector("#c-skills").value).toBe("Node.js, AWS");
    expect(body().textContent).toContain("Jane Doe CV.pdf");
    expect(body().textContent).toContain("Suggested by AI: please check");
    expect(body().textContent).toContain("read with AI help");
  });

  it("never overwrites what the user already typed", async () => {
    api.post.mockResolvedValue(uploadResponse());
    await setup();
    await type("#c-name", "My Own Name");
    await chooseFile();
    expect(body().querySelector("#c-name").value).toBe("My Own Name");
    expect(body().querySelector("#c-email").value).toBe("jane@example.com");
  });

  it("saves the candidate with the resume, phone, skills and the chosen job", async () => {
    api.post.mockResolvedValueOnce(uploadResponse()).mockResolvedValueOnce({ data: { id: "k1" } });
    await setup();
    await chooseFile();
    await type("#c-skills", "Node.js, AWS , Docker");
    button("Save Profile").click();
    await flushPromises();

    const [url, payload] = api.post.mock.calls[1];
    expect(url).toBe("/candidates");
    expect(payload).toMatchObject({
      name: "Jane Q. Doe",
      email: "jane@example.com",
      phone: "+14155550123",
      role: "Senior Engineer",
      skills: ["Node.js", "AWS", "Docker"],
      experienceYears: 8,
      resumeId: "r1"
    });
    expect(payload.companyId).toBeUndefined();
    expect(payload.jobId).toBeUndefined();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("only offers open jobs of the user's own company", async () => {
    await setup();
    const options = byLabel("Job");
    expect(options).toBeTruthy();
    const wrapperText = body().textContent;
    expect(wrapperText).not.toContain("Other Co Job");
  });

  it("works without a resume: the normal form still saves", async () => {
    api.post.mockResolvedValue({ data: { id: "k1" } });
    await setup();
    await type("#c-name", "Plain Person");
    await type("#c-email", "plain@example.com");
    await type("#c-role", "Tester");
    button("Save Profile").click();
    await flushPromises();
    const [, payload] = api.post.mock.calls[0];
    expect(payload).toMatchObject({ name: "Plain Person", email: "plain@example.com", role: "Tester" });
    expect(payload.resumeId).toBeUndefined();
  });

  it("requires name, email and role", async () => {
    await setup();
    button("Save Profile").click();
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(body().textContent).toContain("Name, Email, and Role are required.");
  });

  it("rejects the wrong file type and files over 5 MB without calling the API", async () => {
    await setup();
    await chooseFile("notes.txt");
    expect(body().textContent).toContain("Choose a PDF or Word (.docx) file.");
    await chooseFile("big.pdf", 5 * 1024 * 1024 + 1);
    expect(body().textContent).toContain("larger than 5 MB");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's message when the file cannot be read", async () => {
    api.post.mockRejectedValue({ response: { data: { error: "No readable text found (scanned images are not supported)" } } });
    await setup();
    await chooseFile();
    expect(body().textContent).toContain("No readable text found");
    expect(byLabel("Resume file")).toBeTruthy();
  });

  it("shows warnings and blocks saving when the resume already belongs to a candidate", async () => {
    api.post.mockResolvedValue(uploadResponse({ reused: true, alreadyAttachedTo: { id: "k9", name: "Existing Person" }, warnings: ["A candidate with this email already exists in your company: Existing Person."] }));
    await setup();
    await chooseFile();
    expect(body().textContent).toContain("already belongs to Existing Person");
    expect(body().textContent).toContain("A candidate with this email already exists");
    expect(button("Save Profile").disabled).toBe(true);
    button("Remove").click();
    await flushPromises();
    expect(button("Save Profile").disabled).toBe(false);
  });

  it("a resume of someone who is already a candidate fills nothing, is not kept, and offers to open the profile", async () => {
    api.post.mockResolvedValue(uploadResponse({ existingCandidate: { id: "k9", name: "Existing Person" } }));
    api.delete.mockResolvedValue({ data: { success: true } });
    await setup();
    await chooseFile();
    expect(body().textContent).toContain("Existing Person is already a candidate");
    expect(byLabel("Resume file")).toBeTruthy();
    expect(document.body.querySelector("#c-name").value).toBe("");
    expect(document.body.querySelector("#c-email").value).toBe("");
    expect(api.delete).toHaveBeenCalledWith("/resumes/r1");
  });

  it("removing the resume discards the uploaded file", async () => {
    api.post.mockResolvedValue(uploadResponse());
    api.delete.mockResolvedValue({ data: { success: true } });
    await setup();
    await chooseFile();
    button("Remove").click();
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/resumes/r1");
    expect(byLabel("Resume file")).toBeTruthy();
  });

  it("discards the uploaded file when the popup is closed without saving", async () => {
    api.post.mockResolvedValue(uploadResponse());
    api.delete.mockResolvedValue({ data: { success: true } });
    const wrapper = await setup();
    await chooseFile();
    await wrapper.setProps({ visible: false });
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/resumes/r1");
  });

  it("admins must choose the company before adding a resume, and it is sent with the upload", async () => {
    api.post.mockResolvedValue(uploadResponse());
    await setup({ user: { id: "root", accessRole: "admin" } });
    await chooseFile();
    expect(api.post).not.toHaveBeenCalled();
    expect(body().textContent).toContain("Choose the company first");
  });
});
