import { can } from "@acmp/shared";
import { findUserById, toActor } from "../services/userStore.js";
import { verifyToken } from "../utils/jwt.js";

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Builds the middleware around a user loader so tests can inject one.
// Roles, teams and active status are read from the user record on every request,
// so a role change or deactivation takes effect immediately (the token only proves identity).
export function createRequireAuth(loadUser = findUserById) {
  return async function requireAuth(req, res, next) {
    const token =
      readCookie(req, "auth_token") ||
      req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const payload = token ? verifyToken(token) : null;

    if (!payload?.id) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const user = await loadUser(payload.id);
      if (!user || user.isActive === false) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      req.auth = payload;
      req.user = toActor(user);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireAuth = createRequireAuth();

// Use after requireAuth. Responds 403 when the user's role lacks the permission.
export function requirePermission(permission) {
  return function checkPermission(req, res, next) {
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: "You do not have permission to do this" });
    }
    return next();
  };
}
