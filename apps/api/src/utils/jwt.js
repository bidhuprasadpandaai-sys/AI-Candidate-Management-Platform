import crypto from "node:crypto";

const MIN_SECRET_LENGTH = 32;

// Read lazily: ES module imports run before dotenv.config() in index.js.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters (see apps/api/.env.example)`
    );
  }
  return secret;
}

export function assertJwtSecret() {
  getSecret();
}
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

// Tokens are stateless and cannot be revoked, so keep them short-lived.
export function getTokenTtlSeconds() {
  const configured = Number(process.env.JWT_EXPIRES_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.min(Math.max(Math.floor(configured), MIN_TTL_SECONDS), MAX_TTL_SECONDS);
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(unsignedToken) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(unsignedToken)
    .digest("base64url");
}

export function signToken(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + getTokenTtlSeconds()
  };
  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(body)}`;
  return `${unsignedToken}.${sign(unsignedToken)}`;
}

export function verifyToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) {
      return null;
    }

    const [header, payload, signature] = parts;
    const unsignedToken = `${header}.${payload}`;
    const expectedSignature = sign(unsignedToken);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decoded;
  } catch (err) {
    return null;
  }
}
