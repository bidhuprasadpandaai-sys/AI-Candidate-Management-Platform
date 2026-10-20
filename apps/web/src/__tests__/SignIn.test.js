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

describe("SignIn view: email code (OTP)", () => {
  beforeEach(() => vi.clearAllMocks());

  async function openOtpTab(wrapper) {
    await wrapper.findAll(".mode-tabs button")[1].trigger("click");
    await flushPromises();
  }

  it("shows the Password tab by default and can switch to Email code", async () => {
    const wrapper = mountSignIn();
    expect(wrapper.find("input#email").exists()).toBe(true);
    await openOtpTab(wrapper);
    expect(wrapper.find("input#otp-email").exists()).toBe(true);
    expect(wrapper.find("input[type=password]").exists()).toBe(false);
  });

  it("requires an email before requesting a code", async () => {
    const wrapper = mountSignIn();
    await openOtpTab(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Email is required.");
  });

  it("requests a code, then verifies it with the 6 digits and navigates home", async () => {
    api.post.mockResolvedValue({ data: {} });
    const wrapper = mountSignIn();
    await openOtpTab(wrapper);

    await wrapper.find("input#otp-email").setValue("  Ada@Example.COM ");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/auth/otp/request", { email: "ada@example.com" }, { withCredentials: true });
    expect(wrapper.find("input#otp-code").exists()).toBe(true);
    expect(wrapper.text()).toContain("ada@example.com");
    expect(wrapper.text()).toMatch(/Resend code in \d+s/);

    await wrapper.find("input#otp-code").setValue("123456");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith(
      "/auth/otp/verify",
      { email: "ada@example.com", code: "123456" },
      { withCredentials: true }
    );
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("rejects codes that are not 6 digits without calling the API", async () => {
    api.post.mockResolvedValue({ data: {} });
    const wrapper = mountSignIn();
    await openOtpTab(wrapper);
    await wrapper.find("input#otp-email").setValue("ada@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    api.post.mockClear();

    await wrapper.find("input#otp-code").setValue("12ab");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(api.post).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Enter the 6-digit code");
  });

  it("shows the server error for a wrong code and stays on the page", async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    const wrapper = mountSignIn();
    await openOtpTab(wrapper);
    await wrapper.find("input#otp-email").setValue("ada@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    api.post.mockRejectedValueOnce({ response: { data: { error: "Invalid or expired code" } } });
    await wrapper.find("input#otp-code").setValue("000000");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("Invalid or expired code");
    expect(replace).not.toHaveBeenCalled();
  });

  it("lets the user go back to change the email", async () => {
    api.post.mockResolvedValue({ data: {} });
    const wrapper = mountSignIn();
    await openOtpTab(wrapper);
    await wrapper.find("input#otp-email").setValue("ada@example.com");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const change = wrapper.findAll("button.link-button").find((b) => b.text().includes("different email"));
    await change.trigger("click");
    expect(wrapper.find("input#otp-code").exists()).toBe(false);
    expect(wrapper.find("input#otp-email").element.disabled).toBe(false);
  });
});
