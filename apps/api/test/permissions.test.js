import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PERMISSIONS,
  ROLES,
  can,
  canAnnotateCandidate,
  canAssignCandidate,
  canDeleteCandidate,
  canEditCandidate,
  canViewCandidate,
  effectiveRole,
  visibleCandidates
} from "@acmp/shared";

const admin = { id: "a", accessRole: "admin" };
const recruiter = { id: "r", accessRole: "recruiter", companyId: "c1" };
const manager = { id: "h", accessRole: "hiring_manager", companyId: "c1" };
const viewer = { id: "v", accessRole: "viewer", companyId: "c1" };
const otherCompany = { id: "o", accessRole: "recruiter", companyId: "c2" };
const noCompany = { id: "n", accessRole: "recruiter" };

const mine = { id: "k1", ownerId: "r", companyId: "c1" };
const teammates = { id: "k2", ownerId: "x", companyId: "c1" };
const unowned = { id: "k3", companyId: "c1" };
const foreign = { id: "k4", ownerId: "y", companyId: "c2" };
const orphan = { id: "k5" };
const all = [mine, teammates, unowned, foreign, orphan];

test("four roles exist and every permission lists only known roles", () => {
  assert.deepEqual(ROLES, ["admin", "recruiter", "hiring_manager", "viewer"]);
  for (const [permission, roles] of Object.entries(PERMISSIONS)) {
    assert.ok(roles.length > 0, permission);
    for (const role of roles) assert.ok(ROLES.includes(role), `${permission}: ${role}`);
  }
});

test("admin-only permissions", () => {
  for (const permission of ["user:manage", "company:manage", "audit:read", "data:seed"]) {
    assert.equal(can(admin, permission), true);
    for (const user of [recruiter, manager, viewer]) assert.equal(can(user, permission), false, `${user.accessRole} ${permission}`);
  }
});

test("read-only role can read but never write", () => {
  assert.equal(can(viewer, "candidate:read"), true);
  assert.equal(can(viewer, "analytics:read"), true);
  for (const permission of ["candidate:create", "candidate:update", "candidate:delete", "candidate:note", "candidate:assign", "chat:use"]) {
    assert.equal(can(viewer, permission), false, permission);
  }
});

test("hiring manager can read and annotate only", () => {
  assert.equal(can(manager, "candidate:note"), true);
  for (const permission of ["candidate:create", "candidate:update", "candidate:delete", "candidate:assign", "chat:use"]) {
    assert.equal(can(manager, permission), false, permission);
  }
});

test("accounts without a role keep recruiter access; unknown roles do too (never admin)", () => {
  assert.equal(effectiveRole({ id: "legacy" }), "recruiter");
  assert.equal(effectiveRole({ accessRole: "superuser" }), "recruiter");
  assert.equal(can({ accessRole: "superuser" }, "user:manage"), false);
  assert.equal(can(null, "candidate:read"), false);
});

test("visibility: the whole company, never another company; admins see everything", () => {
  const ids = (user) => visibleCandidates(user, all).map((c) => c.id);
  assert.deepEqual(ids(admin), ["k1", "k2", "k3", "k4", "k5"]);
  for (const user of [recruiter, manager, viewer]) assert.deepEqual(ids(user), ["k1", "k2", "k3"], user.accessRole);
  assert.deepEqual(ids(otherCompany), ["k4"]);
});

test("a user without a company sees nothing; a candidate without a company is admin-only", () => {
  assert.deepEqual(visibleCandidates(noCompany, all), []);
  assert.deepEqual(visibleCandidates({ id: "z", accessRole: "viewer", companyId: "" }, all), []);
  assert.equal(canViewCandidate(recruiter, orphan), false);
  assert.equal(canViewCandidate(admin, orphan), true);
  assert.equal(canViewCandidate(viewer, null), false);
  assert.equal(canViewCandidate(null, mine), false);
});

test("edit and annotate apply to the whole company, not to other companies", () => {
  assert.equal(canEditCandidate(recruiter, teammates), true, "company-wide edit");
  assert.equal(canEditCandidate(recruiter, foreign), false);
  assert.equal(canEditCandidate(manager, teammates), false);
  assert.equal(canAnnotateCandidate(manager, teammates), true);
  assert.equal(canAnnotateCandidate(manager, foreign), false);
  assert.equal(canAnnotateCandidate(viewer, teammates), false);
});

test("delete: admin or the owning recruiter only", () => {
  assert.equal(canDeleteCandidate(recruiter, mine), true);
  assert.equal(canDeleteCandidate(recruiter, teammates), false);
  assert.equal(canDeleteCandidate(recruiter, unowned), false);
  assert.equal(canDeleteCandidate(admin, foreign), true);
  assert.equal(canDeleteCandidate(manager, mine), false);
});

test("assign: admin; owner; or any recruiter when there is no owner", () => {
  assert.equal(canAssignCandidate(recruiter, mine), true);
  assert.equal(canAssignCandidate(recruiter, unowned), true);
  assert.equal(canAssignCandidate(recruiter, teammates), false);
  assert.equal(canAssignCandidate(recruiter, foreign), false);
  assert.equal(canAssignCandidate(admin, foreign), true);
  assert.equal(canAssignCandidate(manager, unowned), false);
});
