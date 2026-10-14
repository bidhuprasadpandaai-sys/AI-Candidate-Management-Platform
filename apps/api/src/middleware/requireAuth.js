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

export function requireAuth(req, res, next) {
  const token =
    readCookie(req, "auth_token") ||
    req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyToken(token) : null;

  if (!payload?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  req.auth = payload;
  return next();
}
