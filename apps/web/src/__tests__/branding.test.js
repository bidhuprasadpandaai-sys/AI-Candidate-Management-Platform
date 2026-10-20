import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import { PLATFORM, buildThemeVars, initialsOf, textOn } from "../config/brand";
import { useBrandingStore } from "../stores/branding";

describe("brand config", () => {
  it("builds the full colour ramp from two colours", () => {
    const vars = buildThemeVars("#0f766e", "#f59e0b");
    expect(vars["--primary-color"]).toBe("#0f766e");
    expect(vars["--accent-color"]).toBe("#f59e0b");
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) expect(vars[`--primary-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
    expect(vars["--primary-50"]).not.toBe(vars["--primary-900"]);
  });

  it("falls back to the platform colours for invalid input", () => {
    expect(buildThemeVars("teal", null)["--primary-color"]).toBe(PLATFORM.primaryColor);
  });

  it("picks readable text for light and dark brand colours", () => {
    expect(textOn("#ffff00")).toBe("#0f172a");
    expect(textOn("#1e1b4b")).toBe("#ffffff");
  });

  it("makes initials", () => {
    expect(initialsOf("White Label Care")).toBe("WL");
    expect(initialsOf("")).toBe("T");
  });
});

describe("branding store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it("starts with the platform branding", () => {
    const store = useBrandingStore();
    expect(store.title).toBe(PLATFORM.name);
    expect(store.branding.logo).toBeNull();
  });

  it("applies a company's name, logo and colours", async () => {
    api.get.mockResolvedValue({ data: { branding: { companyId: "c1", displayName: "Acme Health", logo: "data:image/png;base64,AAAA", primaryColor: "#0f766e", accentColor: "#f59e0b" } } });
    const store = useBrandingStore();
    await store.load();
    expect(store.title).toBe("Acme Health");
    expect(store.loaded).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--primary-color")).toBe("#0f766e");
    expect(document.title).toBe("Acme Health");
  });

  it("keeps the platform look when branding cannot be loaded", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    const store = useBrandingStore();
    await store.load();
    expect(store.title).toBe(PLATFORM.name);
    expect(document.documentElement.style.getPropertyValue("--primary-color")).toBe(PLATFORM.primaryColor);
  });

  it("resets to the platform look on sign-out", async () => {
    api.get.mockResolvedValue({ data: { branding: { displayName: "Acme Health", primaryColor: "#0f766e" } } });
    const store = useBrandingStore();
    await store.load();
    store.reset();
    expect(store.title).toBe(PLATFORM.name);
    expect(store.loaded).toBe(false);
  });
});
