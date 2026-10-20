import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../services/api", () => ({
  default: { get: vi.fn(), post: vi.fn() },
  getResolvedApiBaseUrl: () => "http://api.test/api"
}));

import api from "../services/api";
import { useAuthStore } from "../stores/auth";

const asRole = (store, accessRole, extra = {}) => {
  store.user = { id: "me", accessRole, companyId: "c1", ...extra };
  return store;
};

describe("auth store: role-aware helpers", () => {
  let store;
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    store = useAuthStore();
  });

  it("has no permissions before sign-in", () => {
    expect(store.can("candidate:read")).toBe(false);
    expect(store.accessRole).toBeNull();
    expect(store.isAdmin).toBe(false);
  });

  it("loadUser stores the user with role and teams; failure clears it", async () => {
    api.get.mockResolvedValueOnce({ data: { user: { id: "me", accessRole: "recruiter", companyId: "c1" } } });
    await store.loadUser();
    expect(store.accessRoleLabel).toBe("Recruiter");
    api.get.mockRejectedValueOnce({ response: { data: { error: "Not authenticated" } } });
    await store.loadUser();
    expect(store.user).toBeNull();
    expect(store.error).toBe("Not authenticated");
  });

  it("admin: everything", () => {
    asRole(store, "admin");
    expect(store.isAdmin).toBe(true);
    for (const p of ["candidate:create", "user:manage", "audit:read"]) expect(store.can(p)).toBe(true);
    expect(store.canDelete({ ownerId: "someone-else", companyId: "other" })).toBe(true);
  });

  it("recruiter: the whole own company, never another company", () => {
    asRole(store, "recruiter");
    expect(store.can("candidate:create")).toBe(true);
    expect(store.can("user:manage")).toBe(false);
    expect(store.canEdit({ ownerId: "me", companyId: "c1" })).toBe(true);
    expect(store.canEdit({ ownerId: "x", companyId: "c1" })).toBe(true);
    expect(store.canEdit({ ownerId: "x", companyId: "c2" })).toBe(false);
    expect(store.canDelete({ ownerId: "x", companyId: "c1" })).toBe(false);
    expect(store.canDelete({ ownerId: "me", companyId: "c1" })).toBe(true);
    expect(store.canAssign({ companyId: "c1" })).toBe(true);
    expect(store.canAssign({ ownerId: "x", companyId: "c1" })).toBe(false);
  });

  it("a user without a company can do nothing with candidates", () => {
    asRole(store, "recruiter", { companyId: null });
    expect(store.canEdit({ ownerId: "me", companyId: "c1" })).toBe(false);
    expect(store.canAnnotate({ companyId: "c1" })).toBe(false);
  });

  it("hiring manager: annotate only; read-only: nothing", () => {
    asRole(store, "hiring_manager");
    const shared = { ownerId: "x", companyId: "c1" };
    expect(store.canAnnotate(shared)).toBe(true);
    expect(store.canEdit(shared)).toBe(false);
    expect(store.can("candidate:create")).toBe(false);
    asRole(store, "viewer");
    expect(store.canAnnotate(shared)).toBe(false);
    expect(store.canEdit(shared)).toBe(false);
    expect(store.can("candidate:read")).toBe(true);
    expect(store.accessRoleLabel).toBe("Read-only");
  });
});
