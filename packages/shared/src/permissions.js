// Access control rules shared by the API (enforcement) and the web app (UI hints).
// The server is the only place that actually enforces them.

export const ROLES = ["admin", "recruiter", "hiring_manager", "viewer"];

export const ROLE_LABELS = {
  admin: "Admin",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  viewer: "Read-only"
};

export const PERMISSIONS = {
  "candidate:read": ["admin", "recruiter", "hiring_manager", "viewer"],
  "candidate:create": ["admin", "recruiter"],
  "candidate:update": ["admin", "recruiter"],
  "candidate:delete": ["admin", "recruiter"],
  "candidate:note": ["admin", "recruiter", "hiring_manager"],
  "candidate:assign": ["admin", "recruiter"],
  "job:read": ["admin", "recruiter", "hiring_manager", "viewer"],
  "job:manage": ["admin", "recruiter"],
  "resume:upload": ["admin", "recruiter"],
  "chat:use": ["admin", "recruiter"],
  "analytics:read": ["admin", "recruiter", "hiring_manager", "viewer"],
  "user:manage": ["admin"],
  "company:manage": ["admin"],
  "audit:read": ["admin"],
  "data:seed": ["admin"]
};

// Accounts created before roles existed have no accessRole; they keep recruiter access.
export function effectiveRole(user) {
  return ROLES.includes(user?.accessRole) ? user.accessRole : "recruiter";
}

export function can(user, permission) {
  if (!user) return false;
  return (PERMISSIONS[permission] || []).includes(effectiveRole(user));
}

const idOf = (value) => (value === undefined || value === null ? "" : String(value));

export function userId(user) {
  return idOf(user?.id ?? user?._id);
}

// Admins are platform-level: they manage companies and users and see every company's data.
// Everyone else belongs to exactly one company and only ever sees that company's candidates.
export function companyIdOf(user) {
  return idOf(user?.companyId);
}

export function isAdmin(user) {
  return effectiveRole(user) === "admin";
}

// Visibility: admins see everything; other roles see all candidates of their own company.
// A candidate without a company is visible to admins only, and a user without a company sees nothing.
export function canViewCandidate(user, candidate) {
  if (!user || !candidate || !can(user, "candidate:read")) return false;
  if (isAdmin(user)) return true;
  const company = companyIdOf(user);
  return Boolean(company) && company === idOf(candidate.companyId);
}

// Edit = change profile fields, status, stage. Needs the permission and visibility.
export function canEditCandidate(user, candidate) {
  return can(user, "candidate:update") && canViewCandidate(user, candidate);
}

// Notes and interviews are open to hiring managers as well.
export function canAnnotateCandidate(user, candidate) {
  return can(user, "candidate:note") && canViewCandidate(user, candidate);
}

// Delete: admins, or the recruiter who owns the candidate (inside their company).
export function canDeleteCandidate(user, candidate) {
  if (!can(user, "candidate:delete") || !canViewCandidate(user, candidate)) return false;
  return isAdmin(user) || idOf(candidate.ownerId) === userId(user);
}

// Change the owner: admins, or a recruiter for candidates they own or that have no owner yet
// (a recruiter can only assign to themselves). The company is changed by admins only.
export function canAssignCandidate(user, candidate) {
  if (!can(user, "candidate:assign") || !canViewCandidate(user, candidate)) return false;
  return isAdmin(user) || idOf(candidate.ownerId) === userId(user) || !idOf(candidate.ownerId);
}

export function visibleCandidates(user, candidates = []) {
  return candidates.filter((candidate) => canViewCandidate(user, candidate));
}
