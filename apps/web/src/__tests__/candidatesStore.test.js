import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import { useCandidateStore } from "../stores/candidates";

describe("candidates store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("starts with the assistant greeting and the default modules", () => {
    const store = useCandidateStore();
    expect(store.chatHistory).toHaveLength(1);
    expect(store.chatHistory[0].role).toBe("assistant");
    expect(store.modules.map((m) => m.id)).toContain("profile");
  });

  it("fetchDashboard stores metrics from the API", async () => {
    api.get.mockResolvedValue({
      data: { metrics: { totalCandidates: 6, shortlisted: 2, hired: 1, averageScore: 80 }, usingMemoryStore: false }
    });
    const store = useCandidateStore();
    await store.fetchDashboard();
    expect(api.get).toHaveBeenCalledWith("/dashboard");
    expect(store.dashboard.totalCandidates).toBe(6);
    expect(store.usingMemoryStore).toBe(false);
  });

  it("fetchCandidates sends filters and stores the page", async () => {
    api.get.mockResolvedValue({ data: { candidates: [{ id: "1" }], total: 42, usingMemoryStore: true } });
    const store = useCandidateStore();
    store.search = "ada";
    store.status = "interview";
    await store.fetchCandidates();
    expect(api.get).toHaveBeenCalledWith(
      "/candidates",
      expect.objectContaining({ params: expect.objectContaining({ search: "ada", status: "interview" }) })
    );
    expect(store.candidates).toEqual([{ id: "1" }]);
    expect(store.totalRecords).toBe(42);
  });

  it("sendMessage ignores blank input", async () => {
    const store = useCandidateStore();
    await store.sendMessage("   ");
    expect(api.post).not.toHaveBeenCalled();
    expect(store.chatHistory).toHaveLength(1);
  });

  it("sendMessage appends user and assistant messages, trimmed", async () => {
    api.post.mockResolvedValue({ data: { reply: "Hello back", actionExecuted: false } });
    const store = useCandidateStore();
    await store.sendMessage("  hi  ");
    expect(api.post).toHaveBeenCalledWith("/chat", { message: "hi" });
    expect(store.chatHistory.slice(-2)).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "Hello back" }
    ]);
    expect(store.chatLoading).toBe(false);
  });

  it("sendMessage refreshes data after an executed action", async () => {
    api.post.mockResolvedValue({ data: { reply: "Updated", actionExecuted: true } });
    api.get.mockResolvedValue({ data: { metrics: {}, candidates: [], usingMemoryStore: true } });
    const store = useCandidateStore();
    await store.sendMessage("move Ada to offer");
    expect(api.get).toHaveBeenCalledWith("/dashboard");
  });

  it("sendMessage shows a friendly message when the API fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.post.mockRejectedValue(new Error("Network Error"));
    const store = useCandidateStore();
    await store.sendMessage("hi");
    expect(store.backendReady).toBe(false);
    expect(store.chatHistory.at(-1).text).toMatch(/unavailable/i);
    expect(store.chatLoading).toBe(false);
  });

  it("deleteCandidate clears the selection when deleting the selected one", async () => {
    api.delete.mockResolvedValue({});
    api.get.mockResolvedValue({ data: { metrics: {}, candidates: [], usingMemoryStore: true } });
    const store = useCandidateStore();
    store.selectCandidate("c1");
    await store.deleteCandidate("c1");
    expect(api.delete).toHaveBeenCalledWith("/candidates/c1");
    expect(store.selectedCandidateId).toBeNull();
  });
});
