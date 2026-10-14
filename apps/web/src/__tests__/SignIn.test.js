import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";

const replace = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ replace }),
  useRoute: () => ({ query: {} })
}));
vi.mock("../services/api", () => ({
  default: { post: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import SignIn from "../views/SignIn.vue";

function mountSignIn() {
  return mount(SignIn, {
    global: { plugins: [PrimeVue], stubs: { "router-link": { template: "<a><slot /></a>" } } }
  });
}

async function fill(wrapper, email, password) {
  await wrapper.find("input#email").setValue(email);
  await wrapper.find("input[type=password]").setValue(password);
}

describe("SignIn view", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires email and password before calling the API", async () => {
    const wrapper = mountSignIn();
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Email and password are required.");
  });

  it("posts normalized credentials with cookies and navigates home", async () => {
    api.post.mockResolvedValue({ data: {} });
    const wrapper = mountSignIn();
    await fill(wrapper, "  Ada@Example.COM ", "Secret123");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith(
      "/auth/signin",
      { email: "ada@example.com", password: "Secret123" },
      { withCredentials: true }
    );
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("shows the server error and stays on the page", async () => {
    api.post.mockRejectedValue({ response: { data: { error: "Invalid credentials" } } });
    const wrapper = mountSignIn();
    await fill(wrapper, "ada@example.com", "wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Invalid credentials");
    expect(replace).not.toHaveBeenCalled();
  });
});
