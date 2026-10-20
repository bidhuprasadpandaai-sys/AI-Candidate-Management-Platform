import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import CandidateDocuments from "../components/CandidateDocuments.vue";

const doc = (extra = {}) => ({
  id: "d1",
  title: "Nursing licence",
  category: "license",
  filename: "licence.pdf",
  type: "pdf",
  size: 204800,
  expiresAt: "2099-01-01",
  status: "valid",
  daysLeft: 9000,
  isExpired: false,
  ...extra
});

async function setup(docs, props = {}) {
  api.get.mockResolvedValue({ data: { documents: docs } });
  const wrapper = mount(CandidateDocuments, { props: { candidateId: "c1", canManage: true, ...props }, global: { plugins: [PrimeVue] }, attachTo: document.body });
  await flushPromises();
  return wrapper;
}

describe("CandidateDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("lists documents with their type, file and expiry state", async () => {
    const wrapper = await setup([
      doc(),
      doc({ id: "d2", title: "Old ID", category: "id_proof", status: "expired", isExpired: true, expiresAt: "2020-01-01", daysLeft: -400 }),
      doc({ id: "d3", title: "Soon", status: "expiring_soon", daysLeft: 5 }),
      doc({ id: "d4", title: "Forever", expiresAt: null, status: "no_expiry", daysLeft: null })
    ]);
    expect(api.get).toHaveBeenCalledWith("/candidates/c1/documents");
    const items = wrapper.findAll('[data-test="document"]');
    expect(items).toHaveLength(4);
    expect(items[0].text()).toContain("Valid until");
    expect(items[1].classes()).toContain("expired");
    expect(items[1].find('[data-test="doc-expiry"]').text()).toContain("Expired");
    expect(items[1].find('[data-test="doc-expiry"]').text()).toContain("Jan 1, 2020");
    expect(items[2].text()).toContain("Expires in 5 days");
    expect(items[3].text()).toContain("No expiry date");
    expect(wrapper.vm.expiredCount).toBe(1);
  });

  it("shows an empty message", async () => {
    const wrapper = await setup([]);
    expect(wrapper.find('[data-test="no-documents"]').exists()).toBe(true);
  });

  it("read-only users can download but not add, edit or delete", async () => {
    const wrapper = await setup([doc()], { canManage: false });
    const labels = wrapper.findAll("button").map((b) => b.attributes("aria-label") || b.text());
    expect(labels).toContain("Download Nursing licence");
    expect(labels.join(" ")).not.toMatch(/Add document|Edit|Delete/);
  });

  it("uploads a file with title, type and expiry date", async () => {
    const wrapper = await setup([]);
    api.post.mockResolvedValue({ data: { document: doc() } });
    await wrapper.findAll("button").find((b) => b.text().includes("Add document")).trigger("click");
    const file = new File([new Uint8Array(20)], "licence.pdf", { type: "application/pdf" });
    const input = wrapper.find('input[aria-label="Document file"]');
    Object.defineProperty(input.element, "files", { value: [file], configurable: true });
    await input.trigger("change");
    expect(wrapper.find('input[aria-label="Document title"]').element.value).toBe("licence");
    await wrapper.find('input[aria-label="Document title"]').setValue("Nursing licence");
    await wrapper.find('input[aria-label="Expiry date"]').setValue("2027-03-31");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith(
      "/candidates/c1/documents",
      file,
      expect.objectContaining({ params: { title: "Nursing licence", category: "certificate", expiresAt: "2027-03-31" }, headers: expect.objectContaining({ "X-Filename": "licence.pdf" }) })
    );
    expect(api.get).toHaveBeenCalledTimes(2); // reloaded the list
  });

  it("refuses wrong file types and large files without calling the API", async () => {
    const wrapper = await setup([]);
    await wrapper.findAll("button").find((b) => b.text().includes("Add document")).trigger("click");
    const input = wrapper.find('input[aria-label="Document file"]');
    Object.defineProperty(input.element, "files", { value: [new File(["x"], "notes.txt")], configurable: true });
    await input.trigger("change");
    expect(wrapper.text()).toContain("Choose a PDF, Word (.docx), PNG or JPEG file up to 5 MB.");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("asks for a file before uploading", async () => {
    const wrapper = await setup([]);
    await wrapper.findAll("button").find((b) => b.text().includes("Add document")).trigger("click");
    await wrapper.find("form").trigger("submit");
    expect(wrapper.text()).toContain("Choose a file first.");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("shows the server's message when the upload is refused", async () => {
    const wrapper = await setup([]);
    api.post.mockRejectedValue({ response: { data: { error: "A candidate can have at most 20 documents" } } });
    await wrapper.findAll("button").find((b) => b.text().includes("Add document")).trigger("click");
    const input = wrapper.find('input[aria-label="Document file"]');
    Object.defineProperty(input.element, "files", { value: [new File([new Uint8Array(5)], "a.png")], configurable: true });
    await input.trigger("change");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("at most 20 documents");
  });

  it("edits the expiry date of a document", async () => {
    const wrapper = await setup([doc({ status: "expired", isExpired: true, expiresAt: "2020-01-01" })]);
    api.patch.mockResolvedValue({ data: { document: doc() } });
    await wrapper.find('[aria-label="Edit Nursing licence"]').trigger("click");
    await wrapper.find('input[aria-label="Edit expiry date"]').setValue("2028-01-01");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/documents/d1", { title: "Nursing licence", category: "license", expiresAt: "2028-01-01" });
  });

  it("clearing the date sends null", async () => {
    const wrapper = await setup([doc()]);
    api.patch.mockResolvedValue({ data: { document: doc() } });
    await wrapper.find('[aria-label="Edit Nursing licence"]').trigger("click");
    await wrapper.find('input[aria-label="Edit expiry date"]').setValue("");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/documents/d1", expect.objectContaining({ expiresAt: null }));
  });

  it("deletes only after confirmation", async () => {
    const wrapper = await setup([doc()]);
    api.delete.mockResolvedValue({ data: { success: true } });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await wrapper.find('[aria-label="Delete Nursing licence"]').trigger("click");
    expect(api.delete).not.toHaveBeenCalled();
    await wrapper.find('[aria-label="Delete Nursing licence"]').trigger("click");
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/documents/d1");
    confirmSpy.mockRestore();
  });

  it("shows a friendly message when the list cannot be loaded", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    const wrapper = mount(CandidateDocuments, { props: { candidateId: "c1", canManage: true }, global: { plugins: [PrimeVue] } });
    await flushPromises();
    expect(wrapper.text()).toContain("The documents could not be loaded.");
  });
});
