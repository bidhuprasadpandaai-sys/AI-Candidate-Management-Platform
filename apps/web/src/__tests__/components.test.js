import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import PrimeVue from "primevue/config";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import AIAssistantPanel from "../components/AIAssistantPanel.vue";
import AppHeader from "../components/AppHeader.vue";
import DashboardCards from "../components/DashboardCards.vue";
import { useCandidateStore } from "../stores/candidates";

function mountWithStore(component) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useCandidateStore();
  const wrapper = mount(component, { global: { plugins: [pinia, PrimeVue] } });
  return { wrapper, store };
}

describe("DashboardCards", () => {
  it("renders the four metrics from the store", async () => {
    const { wrapper, store } = mountWithStore(DashboardCards);
    store.dashboard = { totalCandidates: 6, shortlisted: 3, hired: 1, averageScore: 82 };
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    for (const expected of ["Total candidates", "6", "Shortlisted", "3", "Hired", "1", "Average score", "82%"]) {
      expect(text).toContain(expected);
    }
    expect(wrapper.findAll(".metric-card")).toHaveLength(4);
  });
});

describe("AppHeader", () => {
  it("shows the active module name", async () => {
    const { wrapper, store } = mountWithStore(AppHeader);
    store.setActiveModule("analytics");
    await wrapper.vm.$nextTick();
    expect(wrapper.find("h1").text()).toBe("Analytics");
  });
});

describe("AIAssistantPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the chat history with sender labels", async () => {
    const { wrapper, store } = mountWithStore(AIAssistantPanel);
    store.chatHistory.push({ role: "user", text: "Who is best?" });
    await wrapper.vm.$nextTick();
    const text = wrapper.text();
    expect(text).toContain("AI:");
    expect(text).toContain("You:");
    expect(text).toContain("Who is best?");
  });

  it("sends the typed message to the store and clears the box", async () => {
    const { wrapper, store } = mountWithStore(AIAssistantPanel);
    const spy = vi.spyOn(store, "sendMessage").mockResolvedValue();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("show top candidates");
    await wrapper.find("button").trigger("click");
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith("show top candidates"));
    await wrapper.vm.$nextTick();
    expect(textarea.element.value).toBe("");
  });

  it("sends on Enter but not on Shift+Enter", async () => {
    const { wrapper, store } = mountWithStore(AIAssistantPanel);
    const spy = vi.spyOn(store, "sendMessage").mockResolvedValue();
    const textarea = wrapper.find("textarea");
    await textarea.setValue("hello");
    await textarea.trigger("keydown", { key: "Enter", shiftKey: true });
    expect(spy).not.toHaveBeenCalled();
    await textarea.trigger("keydown", { key: "Enter" });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith("hello"));
  });
});
