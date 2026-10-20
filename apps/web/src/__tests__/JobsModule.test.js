import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import JobsModule from "../components/modules/JobsModule.vue";
import { useAuthStore } from "../stores/auth";
import { useCandidateStore } from "../stores/candidates";

let companyList = [
  { id: "c1", name: "Acme Corp", currencies: ["USD", "EUR"], facilities: [{ id: "f1", name: "Main Hospital" }, { id: "f2", name: "North Clinic" }] },
  { id: "c2", name: "Globex", currencies: ["GBP"], facilities: [{ id: "f9", name: "London Office" }] }
];
const jobs = [
  { id: "j1", companyId: "c1", companyName: "Acme Corp", title: "Senior Engineer", department: "Engineering", location: "Remote", status: "open", hiringManagerName: "Hana", candidateCount: 3, statusCounts: { screening: 2, interview: 1 },
    employmentType: "part_time", currency: "EUR", rateUnit: "hour", payRateMin: 40, payRateMax: 60.5, billRateMin: 70, billRateMax: 90, facilityId: "f1", facilityName: "Main Hospital", expiresAt: "2099-12-31", maxApplications: 5, isExpired: false, isFull: false },
  { id: "j2", companyId: "c1", companyName: "Acme Corp", title: "Designer", department: "", location: "", status: "closed", hiringManagerName: null, candidateCount: 5, statusCounts: {},
    employmentType: "full_time", currency: null, rateUnit: "hour", payRateMin: null, payRateMax: null, billRateMin: null, billRateMax: null, facilityId: null, facilityName: null, expiresAt: "2020-01-01", maxApplications: 5, isExpired: true, isFull: true }
];
const cards = [
  { id: "a1", status: "screening", stage: "Screening stage", fit: { score: 82, level: "strong", label: "Strong fit" }, candidate: { id: "k1", name: "Ada Lovelace", role: "Engineer", skills: ["math", "code"], ownerName: "Olivia", resumeId: "r1", companyId: "c1", email: "a@x.co", phone: "+1415555", location: "London", experienceYears: 7, summary: "Builds engines and writes the first programs for them, very carefully." } },
  { id: "a2", status: "interview", stage: "Interview stage", fit: { score: 55, level: "partial", label: "Partial fit" }, candidate: { id: "k2", name: "Grace Hopper", role: "Engineer", skills: [], ownerName: null, resumeId: null, companyId: "c1" } },
  { id: "a3", status: "screening", stage: "Screening stage", fit: { score: 30, level: "weak", label: "Weak fit" }, candidate: { id: "k3", name: "Alan Turing", role: "Engineer", skills: [], ownerName: null, resumeId: null, companyId: "c1" } }
];

function setup(user = { id: "me", accessRole: "recruiter", companyId: "c1" }) {
  // a tiny fake server: PUT /candidates/:id changes what the next GET returns
  const server = JSON.parse(JSON.stringify(cards));
  api.patch.mockImplementation(async (url, body) => {
    const card = server.find((c) => url.endsWith(`/${c.id}`));
    if (card) Object.assign(card, body);
    return { data: { application: card } };
  });
  api.get.mockImplementation(async (url, config) => {
    if (url === "/jobs") return { data: { jobs: JSON.parse(JSON.stringify(jobs)) } };
    if (url === "/jobs/hiring-managers") return { data: { users: [{ id: "u1", name: "Hana Manager" }] } };
    if (/^\/jobs\/[^/]+\/applications$/.test(url)) return { data: { job: { id: "j1", title: "Senior Engineer", status: "open" }, applications: JSON.parse(JSON.stringify(server)) } };
    if (url === "/candidates") return { data: { candidates: [], total: 0 } };
    if (url === "/dashboard") return { data: { metrics: {} } };
    if (url === "/companies") return { data: { companies: companyList } };
    throw new Error(`unexpected GET ${url}`);
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = user;
  const wrapper = mount(JobsModule, { global: { plugins: [pinia, PrimeVue], stubs: { Sidebar: { template: "<div />" } } } });
  return { wrapper, store: useCandidateStore() };
}

const tab = (wrapper, label) => wrapper.findAll(".jobs-tab").find((t) => t.text().includes(label));

describe("JobsModule: openings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists jobs with status, hiring manager and candidate counts", async () => {
    const { wrapper } = setup();
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Senior Engineer");
    expect(text).toContain("Engineering · Remote");
    expect(text).toContain("Hana");
    expect(text).toContain("Open");
    expect(text).toContain("Closed");
    expect(wrapper.findAll("tbody tr")[0].text()).toContain("3");
  });

  it("recruiters can create, edit and delete; read-only users and hiring managers cannot", async () => {
    const { wrapper } = setup();
    await flushPromises();
    expect(wrapper.text()).toContain("Add job");
    expect(wrapper.findAll("button").some((b) => b.text() === "Edit")).toBe(true);
    for (const accessRole of ["viewer", "hiring_manager"]) {
      const { wrapper: other } = setup({ id: "x", accessRole, companyId: "c1" });
      await flushPromises();
      expect(other.text()).not.toContain("Add job");
      expect(other.findAll("button").some((b) => ["Edit", "Delete", "Close"].includes(b.text()))).toBe(false);
      expect(other.findAll("button").some((b) => b.text().includes("Board"))).toBe(true);
    }
  });

  it("shows exactly one Add job button, even when there are no jobs yet", async () => {
    const full = setup();
    await flushPromises();
    expect(full.wrapper.findAll("button").filter((b) => b.text().trim() === "Add job")).toHaveLength(1);

    api.get.mockImplementation(async (url) => (url === "/jobs" ? { data: { jobs: [] } } : { data: { users: [] } }));
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = { id: "me", accessRole: "recruiter", companyId: "c1" };
    const empty = mount(JobsModule, { global: { plugins: [pinia, PrimeVue], stubs: { Sidebar: { template: "<div />" } } } });
    await flushPromises();
    expect(empty.text()).toContain("No jobs yet.");
    expect(empty.findAll("button").filter((b) => b.text().trim() === "Add job")).toHaveLength(1);
  });

  it("admins see the company column", async () => {
    const { wrapper } = setup({ id: "root", accessRole: "admin" });
    await flushPromises();
    expect(wrapper.findAll("th").some((th) => th.text() === "Company")).toBe(true);
  });

  it("creates a job through the dialog", async () => {
    api.post.mockResolvedValue({ data: { job: jobs[0] } });
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    // the dialog renders in the document body
    const title = document.body.querySelector('input[aria-label="Job title"]');
    title.value = "  Data Analyst ";
    title.dispatchEvent(new Event("input"));
    await flushPromises();
    [...document.body.querySelectorAll("button")].filter((b) => b.textContent.includes("Add job")).at(-1).click();
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/jobs", expect.objectContaining({ title: "Data Analyst", status: "open", hiringManagerId: null }));
  });

  it("requires a title and shows server errors", async () => {
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    [...document.body.querySelectorAll("button")].filter((b) => b.textContent.includes("Add job")).at(-1).click();
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Job title is required.");
  });

  it("closing a job sends the new status; deleting explains a refusal", async () => {
    api.patch.mockResolvedValue({ data: { job: jobs[0] } });
    api.delete.mockRejectedValue({ response: { data: { error: "This job still has 3 candidate(s)." } } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("tbody tr")[0].findAll("button").find((b) => b.text() === "Close").trigger("click");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/jobs/j1", { status: "closed" });
    await wrapper.findAll("tbody tr")[0].findAll("button").find((b) => b.text() === "Delete").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("still has 3 candidate(s)");
  });
});

describe("JobsModule: pipeline board", () => {
  beforeEach(() => vi.clearAllMocks());

  async function openBoard(user) {
    const ctx = setup(user);
    await flushPromises();
    await tab(ctx.wrapper, "Pipeline board").trigger("click");
    await flushPromises();
    return ctx;
  }

  it("loads the first open job's applications and shows a column per stage with its cards", async () => {
    const { wrapper } = await openBoard();
    expect(api.get).toHaveBeenCalledWith("/jobs/j1/applications");
    const columns = wrapper.findAll(".board-column");
    expect(columns).toHaveLength(5);
    expect(columns.map((c) => c.find(".board-count").text())).toEqual(["2", "1", "0", "0", "0"]);
    expect(columns[0].text()).toContain("Ada Lovelace");
    expect(columns[0].text()).toContain("Alan Turing");
    expect(columns[1].text()).toContain("Grace Hopper");
    expect(columns[2].text()).toContain("No candidates");
    expect(wrapper.text()).toContain("Olivia");
    expect(wrapper.find('[aria-label="Resume attached"]').exists()).toBe(true);
  });

  it("shows the fit score for THIS job on every card, coloured by level", async () => {
    const { wrapper } = await openBoard();
    const badges = wrapper.findAll('[data-test="card-fit"]');
    expect(badges.map((b) => b.text())).toEqual(["82", "30", "55"]);
    expect(badges[0].classes()).toContain("fit-strong");
    expect(badges[1].classes()).toContain("fit-weak");
    expect(badges[2].classes()).toContain("fit-partial");
    expect(badges[0].attributes("title")).toBe("Strong fit for this job");
    expect(wrapper.text()).toContain("Fit for this job");
  });

  it("shows each candidate's profile completion on their card", async () => {
    const { wrapper } = await openBoard();
    const cardsEls = wrapper.findAll(".board-card");
    expect(cardsEls).toHaveLength(3);
    for (const card of cardsEls) {
      expect(card.find('[data-test="profile-meter"]').exists()).toBe(true);
      expect(card.find('[data-test="profile-score"]').text()).toMatch(/^\d+%$/);
    }
    const score = (i) => Number(cardsEls[i].find('[data-test="profile-score"]').text().replace("%", ""));
    expect(score(0)).toBeGreaterThan(score(1));
  });

  it("moves a card with the stage menu and updates the counts at once", async () => {
    const { wrapper } = await openBoard();
    await wrapper.find('select[aria-label="Move Ada Lovelace to stage"]').setValue("offer");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/applications/a1", { status: "offer" });
    expect(wrapper.findAll(".board-column")[2].text()).toContain("Ada Lovelace");
  });

  it("moves a card by drag and drop", async () => {
    const { wrapper } = await openBoard();
    const store = useCandidateStore();
    const data = {};
    const dataTransfer = { setData: (k, v) => (data[k] = v), getData: (k) => data[k], effectAllowed: "" };
    const card = wrapper.findAll(".board-card")[0];
    expect(card.attributes("draggable")).toBe("true");
    await card.trigger("dragstart", { dataTransfer });
    await wrapper.findAll(".board-column")[3].trigger("drop", { dataTransfer });
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/applications/a1", { status: "hired" });
    expect(store.boardApplications.find((a) => a.id === "a1").status).toBe("hired");
  });

  it("puts the card back and explains when the server refuses the move", async () => {
    const { wrapper, store } = await openBoard();
    api.patch.mockRejectedValue({ response: { data: { error: "You do not have permission to do this" } } });
    await wrapper.find('select[aria-label="Move Ada Lovelace to stage"]').setValue("rejected");
    await flushPromises();
    expect(store.boardApplications.find((a) => a.id === "a1").status).toBe("screening");
    expect(wrapper.text()).toContain("You do not have permission to do this");
  });

  it("read-only users and hiring managers can look but not move", async () => {
    for (const accessRole of ["viewer", "hiring_manager"]) {
      const { wrapper } = await openBoard({ id: "x", accessRole, companyId: "c1" });
      expect(wrapper.findAll(".board-card").length).toBe(3);
      expect(wrapper.findAll(".board-card")[0].attributes("draggable")).toBe("false");
      expect(wrapper.find("select").exists()).toBe(false);
      expect(wrapper.text()).toContain("view the pipeline but not move");
      expect(wrapper.findAll('[data-test="card-fit"]')).toHaveLength(3);
    }
  });

  it("switching job loads that job's board", async () => {
    const { store } = await openBoard();
    await store.fetchBoard("j2");
    expect(api.get).toHaveBeenLastCalledWith("/jobs/j2/applications");
    expect(store.boardJobId).toBe("j2");
  });

  it("clicking a card opens the candidate in the detail panel", async () => {
    const { wrapper, store } = await openBoard();
    await wrapper.findAll(".board-card__name").find((b) => b.text() === "Grace Hopper").trigger("click");
    expect(store.selectedCandidateId).toBe("k2");
    expect(store.selectedCandidate.name).toBe("Grace Hopper");
  });
});

describe("board loading", () => {
  beforeEach(() => vi.clearAllMocks());

  const fresh = () => JSON.parse(JSON.stringify(cards));
  const prepare = () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().user = { id: "me", accessRole: "recruiter", companyId: "c1" };
    return useCandidateStore();
  };

  it("ignores a slow, out-of-date board response that arrives after a move", async () => {
    const store = prepare();
    let release;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ data: { applications: fresh() } }); }));
    const slow = store.fetchBoard("j1");
    store.boardApplications = fresh();
    api.patch.mockResolvedValue({ data: {} });
    api.get.mockImplementation(async (url) => (url.endsWith("/applications") ? { data: { applications: fresh().map((a) => (a.id === "a1" ? { ...a, status: "offer" } : a)) } } : { data: { metrics: {}, candidates: [], total: 0 } }));
    await store.moveApplication("a1", "offer");
    release();
    await slow;
    expect(store.boardApplications.find((a) => a.id === "a1").status).toBe("offer");
  });

  it("refreshes the board from the server after a successful move", async () => {
    const store = prepare();
    store.boardJobId = "j1";
    store.boardApplications = fresh();
    api.patch.mockResolvedValue({ data: {} });
    api.get.mockResolvedValue({ data: { applications: [], candidates: [], total: 0, metrics: {} } });
    await store.moveApplication("a2", "hired");
    expect(api.get).toHaveBeenCalledWith("/jobs/j1/applications");
  });
});

// ── new job fields ────────────────────────────────────────────────────────────

const dlg = () => document.body;
const field = (label) => {
  const el = dlg().querySelector(`[aria-label="${label}"]`);
  return el && !el.matches("input") ? el.querySelector("input") || el : el;
};
const setValue = async (label, value) => {
  const el = field(label);
  el.value = value;
  el.dispatchEvent(new Event("input"));
  el.dispatchEvent(new Event("blur"));
  await flushPromises();
};
const clickButton = (text) => [...dlg().querySelectorAll("button")].filter((b) => b.textContent.trim().includes(text)).at(-1).click();

describe("JobsModule: pay, bill rates, facility, expiry and application limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    companyList = [
      { id: "c1", name: "Acme Corp", currencies: ["USD", "EUR"], facilities: [{ id: "f1", name: "Main Hospital" }, { id: "f2", name: "North Clinic" }] },
      { id: "c2", name: "Globex", currencies: ["GBP"], facilities: [{ id: "f9", name: "London Office" }] }
    ];
  });

  it("the table shows type, pay rate, bill rate, facility, expiry and applications used", async () => {
    const { wrapper } = setup();
    await flushPromises();
    const row = wrapper.findAll("tbody tr")[0];
    expect(row.text()).toContain("Part time");
    expect(row.find('[data-test="pay-rate"]').text()).toBe("EUR 40 – 60.5 / hour");
    expect(row.find('[data-test="bill-rate"]').text()).toBe("EUR 70 – 90 / hour");
    expect(row.text()).toContain("Main Hospital");
    expect(row.text()).toContain("2099-12-31");
    expect(row.find('[data-test="applications"]').text()).toBe("3 / 5");
    expect(row.text()).not.toContain("Expired");
  });

  it("marks expired and full jobs", async () => {
    const { wrapper } = setup();
    await flushPromises();
    const row = wrapper.findAll("tbody tr")[1];
    expect(row.text()).toContain("Expired");
    expect(row.text()).toContain("Full");
    expect(row.find('[data-test="pay-rate"]').text()).toBe("–");
    expect(row.find('[data-test="applications"]').text()).toBe("5 / 5");
  });

  it("hiring managers and read-only users see pay but no bill rate column", async () => {
    for (const accessRole of ["hiring_manager", "viewer"]) {
      const { wrapper } = setup({ id: "x", accessRole, companyId: "c1" });
      await flushPromises();
      expect(wrapper.findAll("th").some((th) => th.text() === "Bill rate")).toBe(false);
      expect(wrapper.find('[data-test="pay-rate"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="bill-rate"]').exists()).toBe(false);
    }
    const { wrapper } = setup();
    await flushPromises();
    expect(wrapper.findAll("th").some((th) => th.text() === "Bill rate")).toBe(true);
  });

  it("the Add job dialog has every new field, and the company's own lists drive currency and facility", async () => {
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    for (const label of ["Employment type", "Facility", "Currency", "Rate unit", "Pay rate minimum", "Pay rate maximum", "Bill rate minimum", "Bill rate maximum", "Job expiry date", "Maximum applications"]) {
      expect(field(label), label).toBeTruthy();
    }
    const dropdowns = wrapper.findAllComponents({ name: "Dropdown" });
    const prop = (placeholder, name) => dropdowns.find((d) => d.props(name) !== undefined && d.props("options")?.length && d.props("options").some((o) => o.label === placeholder));
    const currency = dropdowns.find((d) => d.props("options")?.some((o) => o.value === "EUR"));
    expect(currency.props("options").map((o) => o.value)).toEqual(["USD", "EUR"]);
    expect(currency.props("modelValue")).toBe("USD");
    const facility = dropdowns.find((d) => d.props("options")?.some((o) => o.label === "Main Hospital"));
    expect(facility.props("options").map((o) => o.label)).toEqual(["Main Hospital", "North Clinic"]);
    expect(prop).toBeTruthy();
    expect(dropdowns.some((d) => d.props("options")?.some((o) => o.label === "London Office"))).toBe(false);
  });

  it("sends all the new fields when creating a job", async () => {
    api.post.mockResolvedValue({ data: { job: jobs[0] } });
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    await setValue("Job title", "Registered Nurse");
    await setValue("Pay rate minimum", "40");
    await setValue("Pay rate maximum", "60.5");
    await setValue("Bill rate minimum", "70");
    await setValue("Bill rate maximum", "90");
    await setValue("Maximum applications", "25");
    await setValue("Job expiry date", "2099-06-30");
    const dropdowns = wrapper.findAllComponents({ name: "Dropdown" });
    dropdowns.find((d) => d.props("options")?.some((o) => o.label === "Part time")).vm.$emit("update:modelValue", "part_time");
    dropdowns.find((d) => d.props("options")?.some((o) => o.label === "Main Hospital")).vm.$emit("update:modelValue", "f1");
    dropdowns.find((d) => d.props("options")?.some((o) => o.value === "EUR")).vm.$emit("update:modelValue", "EUR");
    await flushPromises();
    clickButton("Add job");
    await flushPromises();
    const [url, payload] = api.post.mock.calls[0];
    expect(url).toBe("/jobs");
    expect(payload).toMatchObject({
      title: "Registered Nurse", employmentType: "part_time", currency: "EUR", rateUnit: "hour",
      payRateMin: 40, payRateMax: 60.5, billRateMin: 70, billRateMax: 90, facilityId: "f1", expiresAt: "2099-06-30", maxApplications: 25
    });
  });

  it("refuses a minimum above the maximum or an expiry in the past without calling the API", async () => {
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    await setValue("Job title", "Nurse");
    await setValue("Pay rate minimum", "50");
    await setValue("Pay rate maximum", "40");
    clickButton("Add job");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(dlg().textContent).toContain("Pay rate minimum cannot be higher than the maximum.");

    await setValue("Pay rate maximum", "60");
    await setValue("Bill rate minimum", "90");
    await setValue("Bill rate maximum", "80");
    clickButton("Add job");
    await flushPromises();
    expect(dlg().textContent).toContain("Bill rate minimum cannot be higher than the maximum.");

    await setValue("Bill rate maximum", "100");
    await setValue("Job expiry date", "2020-01-01");
    clickButton("Add job");
    await flushPromises();
    expect(dlg().textContent).toContain("The expiry date cannot be in the past.");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's message when a company rule refuses the job", async () => {
    api.post.mockRejectedValue({ response: { data: { error: "Choose one of this company's currencies: USD, EUR" } } });
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    await setValue("Job title", "Nurse");
    clickButton("Add job");
    await flushPromises();
    expect(dlg().textContent).toContain("Choose one of this company's currencies");
  });

  it("editing a job fills the form from it", async () => {
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("tbody tr")[0].findAll("button").find((b) => b.text() === "Edit").trigger("click");
    await flushPromises();
    expect(field("Job title").value).toBe("Senior Engineer");
    expect(field("Pay rate maximum").value).toContain("60.5");
    expect(field("Job expiry date").value).toBe("2099-12-31");
    expect(field("Maximum applications").value).toBe("5");
  });

  it("admins pick the company first; switching company swaps the currency and facility lists", async () => {
    const { wrapper } = setup({ id: "root", accessRole: "admin" });
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    const dropdowns = () => wrapper.findAllComponents({ name: "Dropdown" });
    const companyDropdown = dropdowns().find((d) => d.props("options")?.some((o) => o.label === "Globex"));
    companyDropdown.vm.$emit("update:modelValue", "c2");
    await flushPromises();
    const currency = dropdowns().find((d) => d.props("options")?.some((o) => o.value === "GBP"));
    expect(currency.props("options").map((o) => o.value)).toEqual(["GBP"]);
    expect(currency.props("modelValue")).toBe("GBP");
    expect(dropdowns().some((d) => d.props("options")?.some((o) => o.label === "London Office"))).toBe(true);
    expect(dropdowns().some((d) => d.props("options")?.some((o) => o.label === "Main Hospital"))).toBe(false);
  });
});


describe("JobsModule: adding a facility from the job form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    companyList = [{ id: "c1", name: "Acme Corp", currencies: ["USD"], facilities: [{ id: "f1", name: "Main Hospital", location: "Boston", address: "1 Main St", pinCode: "02108" }] }];
  });

  const bodyField = (label) => document.body.querySelector(`[aria-label="${label}"]`);
  const type = async (label, value) => {
    const el = bodyField(label);
    el.value = value;
    el.dispatchEvent(new Event("input"));
    await flushPromises();
  };
  const press = (text) => [...document.body.querySelectorAll("button")].filter((b) => b.textContent.trim().includes(text)).at(-1);

  async function openFacilityDialog() {
    const ctx = setup();
    await flushPromises();
    await ctx.wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    press("Add new facility").click();
    await flushPromises();
    return ctx;
  }

  it("shows the facility's location next to its name in the list", async () => {
    const { wrapper } = setup();
    await flushPromises();
    await wrapper.findAll("button").find((b) => b.text().includes("Add job")).trigger("click");
    await flushPromises();
    const facility = wrapper.findAllComponents({ name: "Dropdown" }).find((d) => d.props("options")?.some((o) => o.value === "f1"));
    expect(facility.props("options")[0].label).toBe("Main Hospital · Boston");
  });

  it("opens a form with name, location, address and pin code, for this company only", async () => {
    await openFacilityDialog();
    expect(document.body.textContent).toContain("New facility for Acme Corp");
    expect(document.body.textContent).toContain("Other companies never see it");
    expect(document.body.querySelectorAll(".p-dialog")).toHaveLength(1); // inline, not a second dialog
    for (const label of ["Facility name", "Facility location", "Facility address", "Facility pin code"]) expect(bodyField(label), label).toBeTruthy();
    expect(document.body.querySelector("datalist option").value).toBe("Boston"); // location suggestions come from this company's facilities
  });

  it("saves the facility to the company, refreshes the list and selects it for the job", async () => {
    api.post.mockImplementation(async (url) => {
      if (url === "/companies/c1/facilities") {
        const facility = { id: "f2", name: "North Clinic", location: "Leeds", address: "9 High Rd", pinCode: "LS1 4AP" };
        companyList = [{ ...companyList[0], facilities: [...companyList[0].facilities, facility] }];
        return { status: 201, data: { facility, facilities: companyList[0].facilities } };
      }
      return { data: {} };
    });
    const { wrapper } = await openFacilityDialog();
    await type("Facility name", "  North Clinic ");
    await type("Facility location", "Leeds");
    await type("Facility address", "9 High Rd");
    await type("Facility pin code", "LS1 4AP");
    press("Add facility").click();
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/companies/c1/facilities", { name: "North Clinic", location: "Leeds", address: "9 High Rd", pinCode: "LS1 4AP" });
    const facility = wrapper.findAllComponents({ name: "Dropdown" }).find((d) => d.props("options")?.some((o) => o.value === "f2"));
    expect(facility).toBeTruthy();
    expect(facility.props("modelValue")).toBe("f2");
    expect(document.body.textContent).not.toContain("New facility for Acme Corp");
  });

  it("needs a name and shows the server's message when the facility is refused", async () => {
    await openFacilityDialog();
    press("Add facility").click();
    await flushPromises();
    expect(document.body.textContent).toContain("Give the facility a name.");
    expect(api.post).not.toHaveBeenCalled();
    api.post.mockRejectedValue({ response: { data: { error: 'This company already has a facility called "Main Hospital"' } } });
    await type("Facility name", "Main Hospital");
    press("Add facility").click();
    await flushPromises();
    expect(document.body.textContent).toContain("already has a facility called");
  });
});
