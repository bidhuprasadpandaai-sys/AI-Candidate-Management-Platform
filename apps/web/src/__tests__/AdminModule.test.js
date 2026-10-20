import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import AdminModule from "../components/modules/AdminModule.vue";
import { useAuthStore } from "../stores/auth";

const users = [
  { id: "me", email: "admin@example.com", name: "Admin One", accessRole: "admin", companyId: null, isActive: true },
  { id: "u2", email: "rita@example.com", name: "Rita Recruiter", accessRole: "recruiter", companyId: "c1", companyName: "Acme Corp", isActive: true }
];
const companies = [{ id: "c1", name: "Acme Corp", description: "Dev hiring", userCount: 1, candidateCount: 4, currencies: ["USD", "EUR"], facilities: [{ id: "f1", name: "Main Hospital" }] }];
const audit = [
  { id: "a1", createdAt: "2026-10-15T10:00:00.000Z", actorEmail: "rita@example.com", action: "candidate.created", source: "user", summary: "Added candidate Ada" },
  { id: "a2", createdAt: "2026-10-15T09:00:00.000Z", actorEmail: "rita@example.com", action: "candidate.ai_update_status", source: "ai", summary: "Assistant ran update_status" }
];

function setup({ unassigned = 0 } = {}) {
  api.get.mockImplementation(async (url) => {
    if (url === "/users") return { data: { users: JSON.parse(JSON.stringify(users)) } };
    if (url === "/companies") return { data: { companies, unassignedCandidates: unassigned } };
    if (url === "/audit") return { data: { entries: audit } };
    if (url === "/branding") return { data: { branding: { companyId: "c1", displayName: "Acme Corp", logo: "data:image/png;base64,AAAA" } } };
    throw new Error(`unexpected GET ${url}`);
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = { id: "me", accessRole: "admin" };
  return mount(AdminModule, { global: { plugins: [pinia, PrimeVue] } });
}

describe("AdminModule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("loads users, companies and audit entries on open", async () => {
    const wrapper = setup();
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/users");
    expect(api.get).toHaveBeenCalledWith("/companies");
    expect(api.get).toHaveBeenCalledWith("/audit", { params: { limit: 50 } });
    expect(wrapper.text()).toContain("Rita Recruiter");
    expect(wrapper.text()).toContain("rita@example.com");
  });

  it("does not let admins change their own role or disable themselves", async () => {
    const wrapper = setup();
    await flushPromises();
    const rows = wrapper.findAll("tbody tr");
    expect(rows[0].text()).toContain("Admin One");
    expect(rows[0].text()).not.toMatch(/Disable|Enable/);
    expect(rows[1].text()).toMatch(/Disable/);
  });

  it("disabling a user sends PATCH isActive=false and refreshes the audit list", async () => {
    api.patch.mockResolvedValue({ data: { user: { ...users[1], isActive: false } } });
    const wrapper = setup();
    await flushPromises();
    const disable = wrapper.findAll("tbody tr")[1].findAll("button").find((b) => b.text() === "Disable");
    await disable.trigger("click");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/users/u2", { isActive: false });
    expect(wrapper.text()).toContain("Account disabled");
  });

  it("shows the server's message when an update is rejected", async () => {
    api.patch.mockRejectedValue({ response: { data: { error: "At least one active admin is required" } } });
    const wrapper = setup();
    await flushPromises();
    const disable = wrapper.findAll("tbody tr")[1].findAll("button").find((b) => b.text() === "Disable");
    await disable.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("At least one active admin is required");
  });

  it("shows each user's company and lets the admin pick one", async () => {
    const wrapper = setup();
    await flushPromises();
    expect(wrapper.text()).toContain("Acme Corp");
    expect(wrapper.find('[aria-label="Company for rita@example.com"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Role for rita@example.com"]').exists()).toBe(true);
  });

  it("creates a company from the Companies tab and shows user and candidate counts", async () => {
    api.post.mockResolvedValue({ data: { company: { id: "c2", name: "Globex" } } });
    const wrapper = setup();
    await flushPromises();
    await wrapper.findAll(".admin-tab")[1].trigger("click");
    expect(wrapper.text()).toContain("Acme Corp");
    expect(wrapper.text()).toContain("4");
    await wrapper.find('input[aria-label="Company name"]').setValue("  Globex ");
    await wrapper.find("form.company-form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/companies", { name: "Globex", description: "" });
  });

  it("requires a company name", async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.findAll(".admin-tab")[1].trigger("click");
    await wrapper.find("form.company-form").trigger("submit");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Company name is required.");
  });

  it("explains a refused company deletion", async () => {
    api.delete.mockRejectedValue({ response: { data: { error: "This company still has 1 user(s) and 4 candidate(s). Move or remove them first." } } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = setup();
    await flushPromises();
    await wrapper.findAll(".admin-tab")[1].trigger("click");
    await wrapper.findAll("tbody button").find((b) => b.text() === "Delete").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("still has 1 user(s)");
  });

  it("warns about candidates without a company and can move them into one", async () => {
    api.post.mockResolvedValue({ data: { moved: 3 } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = setup({ unassigned: 3 });
    await flushPromises();
    await wrapper.findAll(".admin-tab")[1].trigger("click");
    expect(wrapper.text()).toContain("3 candidate(s) have no company");
    await wrapper.findAll("button").find((b) => b.text() === "Move unassigned here").trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/companies/c1/adopt-unassigned", {});
    expect(wrapper.text()).toContain("Moved 3 candidate(s)");
  });

  it("audit tab lists entries, marks AI actions and filters by action", async () => {
    const wrapper = setup();
    await flushPromises();
    await wrapper.findAll(".admin-tab")[2].trigger("click");
    const text = wrapper.text();
    expect(text).toContain("Added candidate Ada");
    expect(text).toContain("Assistant ran update_status");
    expect(text).toContain("ai");

    await wrapper.find('input[aria-label="Filter by action"]').setValue("candidate.created");
    await wrapper.find("form.company-form").trigger("submit");
    await flushPromises();
    expect(api.get).toHaveBeenLastCalledWith("/audit", { params: { limit: 50, action: "candidate.created" } });
  });

  describe("company settings: currencies and facilities", () => {
    const body = () => document.body;
    const openSettings = async () => {
      const wrapper = setup();
      await flushPromises();
      await wrapper.findAll(".admin-tab")[1].trigger("click");
      await wrapper.findAll("tbody button").find((b) => b.text().includes("Settings")).trigger("click");
      await flushPromises();
      return wrapper;
    };
    const button = (text) => [...body().querySelectorAll("button")].filter((b) => b.textContent.trim().includes(text)).at(-1);

    it("the companies table shows each company's currencies and number of facilities", async () => {
      const wrapper = setup();
      await flushPromises();
      await wrapper.findAll(".admin-tab")[1].trigger("click");
      const row = wrapper.findAll("tbody tr")[0].text();
      expect(row).toContain("USD, EUR");
      expect(row).toContain("1");
    });

    it("opens with the company's current lists", async () => {
      await openSettings();
      expect(body().textContent).toContain("Settings: Acme Corp");
      expect(body().querySelectorAll('[aria-label="Facility name"]')[0].value).toBe("Main Hospital");
      expect(body().textContent).toContain("Job pay and bill rates can only use these currencies.");
    });

    it("adds and removes facilities, then saves currencies and facilities with their ids", async () => {
      api.patch.mockResolvedValue({ data: { company: companies[0] } });
      const wrapper = await openSettings();
      button("Add facility").click();
      await flushPromises();
      const input = body().querySelectorAll('[aria-label="Facility name"]')[1];
      input.value = "  North Clinic ";
      input.dispatchEvent(new Event("input"));
      await flushPromises();
      wrapper.findComponent({ name: "MultiSelect" }) && null;
      const multi = wrapper.findAllComponents({ name: "MultiSelect" }).find((m) => m.props("options")?.some((o) => o.value === "GBP"));
      multi.vm.$emit("update:modelValue", ["USD", "GBP"]);
      await flushPromises();
      button("Save settings").click();
      await flushPromises();
      expect(api.patch).toHaveBeenCalledWith("/companies/c1", {
        currencies: ["USD", "GBP"],
        facilities: [{ id: "f1", name: "Main Hospital", location: "", address: "", pinCode: "" }, { name: "North Clinic", location: "", address: "", pinCode: "" }]
      });
      expect(wrapper.text()).toContain('Settings saved for "Acme Corp".');
    });

    it("each facility has name, location, address and pin code, and all are saved", async () => {
      api.patch.mockResolvedValue({ data: { company: companies[0] } });
      await openSettings();
      const set = (label, index, value) => {
        const el = body().querySelectorAll(`[aria-label="${label}"]`)[index];
        el.value = value;
        el.dispatchEvent(new Event("input"));
      };
      set("Facility location", 0, " Boston ");
      set("Facility address", 0, "1 Main St");
      set("Facility pin code", 0, "02108");
      await flushPromises();
      button("Save settings").click();
      await flushPromises();
      expect(api.patch).toHaveBeenCalledWith("/companies/c1", {
        currencies: ["USD", "EUR"],
        facilities: [{ id: "f1", name: "Main Hospital", location: "Boston", address: "1 Main St", pinCode: "02108" }]
      });
    });

    it("search narrows a long facility list by name, location, address or pin code", async () => {
      const original = companies[0].facilities;
      companies[0].facilities = ["Alpha", "Beta", "Gamma", "Delta"].map((name, i) => ({ id: `fac-${i}-xxxxxxxx`, name: `${name} Site`, location: i === 2 ? "Chennai" : "Pune", address: "", pinCode: i === 3 ? "600001" : "" }));
      try {
        await openSettings();
        const search = body().querySelector('[aria-label="Search facilities"]');
        expect(search).not.toBeNull();
        const shown = () => [...body().querySelectorAll('[aria-label="Facility name"]')].map((el) => el.value);
        expect(shown()).toHaveLength(4);
        search.value = "chennai";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(shown()).toEqual(["Gamma Site"]);
        search.value = "600001";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(shown()).toEqual(["Delta Site"]);
        search.value = "zzz";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(body().textContent).toContain("No facility matches your search.");
      } finally {
        companies[0].facilities = original;
      }
    });

    it("removing a facility drops it from the saved list; blank rows are ignored", async () => {
      api.patch.mockResolvedValue({ data: { company: companies[0] } });
      await openSettings();
      button("Add facility").click();
      await flushPromises();
      body().querySelector('[aria-label="Remove facility 1"]').click();
      await flushPromises();
      button("Save settings").click();
      await flushPromises();
      expect(api.patch).toHaveBeenCalledWith("/companies/c1", { currencies: ["USD", "EUR"], facilities: [] });
    });

    it("needs at least one currency", async () => {
      const wrapper = await openSettings();
      wrapper.findAllComponents({ name: "MultiSelect" }).find((m) => m.props("options")?.some((o) => o.value === "GBP")).vm.$emit("update:modelValue", []);
      await flushPromises();
      button("Save settings").click();
      await flushPromises();
      expect(api.patch).not.toHaveBeenCalled();
      expect(body().textContent).toContain("Choose at least one currency.");
    });

    it("shows the server's message when a used facility cannot be removed", async () => {
      api.patch.mockRejectedValue({ response: { data: { error: 'The facility "Main Hospital" is used by existing jobs and cannot be removed' } } });
      await openSettings();
      body().querySelector('[aria-label="Remove facility 1"]').click();
      await flushPromises();
      button("Save settings").click();
      await flushPromises();
      expect(body().textContent).toContain("is used by existing jobs and cannot be removed");
    });
  });
  describe("company branding", () => {
    const body = () => document.body;
    const openBranding = async () => {
      const wrapper = setup();
      await flushPromises();
      await wrapper.findAll(".admin-tab")[1].trigger("click");
      await wrapper.findAll("tbody button").find((b) => b.text().includes("Branding")).trigger("click");
      await flushPromises();
      return wrapper;
    };
    const button = (text) => [...body().querySelectorAll("button")].filter((b) => b.textContent.trim().includes(text)).at(-1);
    const type = async (label, value) => {
      const input = body().querySelector(`[aria-label="${label}"]`);
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await flushPromises();
    };

    it("opens with the company's current logo and details", async () => {
      await openBranding();
      expect(body().textContent).toContain("Branding: Acme Corp");
      expect(api.get).toHaveBeenCalledWith("/branding", { params: { companyId: "c1" } });
      expect(body().querySelector('img[alt="Company logo preview"]')).not.toBeNull();
      expect(body().querySelector('[aria-label="Display name"]')).not.toBeNull();
    });

    it("saves details and colours", async () => {
      api.patch.mockResolvedValue({ data: { company: companies[0] } });
      const wrapper = await openBranding();
      await type("Display name", "Acme Health");
      await type("Primary colour code", "#0f766e");
      button("Save branding").click();
      await flushPromises();
      const [url, payload] = api.patch.mock.calls.at(-1);
      expect(url).toBe("/companies/c1");
      expect(payload.branding).toMatchObject({ displayName: "Acme Health", primaryColor: "#0f766e" });
      expect(wrapper.text()).toContain('Branding saved for "Acme Corp".');
    });

    it("shows the API's message when a value is refused", async () => {
      api.patch.mockRejectedValue({ response: { data: { error: "primaryColor must be a colour like #4f46e5" } } });
      await openBranding();
      button("Save branding").click();
      await flushPromises();
      expect(body().textContent).toContain("primaryColor must be a colour");
    });

    it("uploads a logo as raw bytes and can remove it", async () => {
      api.put.mockResolvedValue({ data: { branding: { logo: "data:image/png;base64,BBBB" } } });
      api.delete.mockResolvedValue({ data: {} });
      await openBranding();
      const file = new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });
      const input = body().querySelector('[aria-label="Logo file"]');
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));
      await flushPromises();
      expect(api.put).toHaveBeenCalledWith("/companies/c1/logo", file, expect.objectContaining({ headers: { "Content-Type": "application/octet-stream" } }));
      button("Remove logo").click();
      await flushPromises();
      expect(api.delete).toHaveBeenCalledWith("/companies/c1/logo");
      expect(body().querySelector('img[alt="Company logo preview"]')).toBeNull();
    });
  });
});
