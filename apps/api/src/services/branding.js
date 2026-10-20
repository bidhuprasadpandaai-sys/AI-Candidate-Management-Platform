// Company branding (white-label) rules: text details, colours and a small logo image.
// The logo type is decided from its bytes, never from the file name or Content-Type.
export const MAX_LOGO_BYTES = 256 * 1024;

export const DEFAULT_BRANDING = {
  displayName: "",
  tagline: "",
  website: "",
  supportEmail: "",
  phone: "",
  address: "",
  primaryColor: "#4f46e5",
  accentColor: "#0ea5e9"
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TEXT_LIMITS = { displayName: 80, tagline: 120, phone: 40, address: 200 };

export function cleanBranding(body) {
  const errors = [];
  const value = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return { value, errors: ["branding must be an object"] };

  for (const [key, max] of Object.entries(TEXT_LIMITS)) {
    if (body[key] === undefined) continue;
    const text = typeof body[key] === "string" ? body[key].trim() : null;
    if (text === null || text.length > max) errors.push(`${key} must be text of at most ${max} characters`);
    else value[key] = text;
  }
  if (body.website !== undefined) {
    const text = typeof body.website === "string" ? body.website.trim() : null;
    let ok = text === "";
    if (text) {
      try {
        ok = ["http:", "https:"].includes(new URL(text).protocol) && text.length <= 200;
      } catch {
        ok = false;
      }
    }
    if (!ok) errors.push("website must be a full http or https address");
    else value.website = text;
  }
  if (body.supportEmail !== undefined) {
    const text = typeof body.supportEmail === "string" ? body.supportEmail.trim() : null;
    if (text === null || (text !== "" && (!EMAIL.test(text) || text.length > 120))) errors.push("supportEmail must be a valid email address");
    else value.supportEmail = text;
  }
  for (const key of ["primaryColor", "accentColor"]) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || !HEX.test(body[key])) errors.push(`${key} must be a colour like #4f46e5`);
    else value[key] = body[key].toLowerCase();
  }
  return { value, errors };
}

export function detectLogoType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length > 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

// Returns a data URL for a valid logo, or throws an Error with a user-facing message.
export function logoToDataUrl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Send the logo image as the request body");
  if (buffer.length > MAX_LOGO_BYTES) throw new Error(`The logo must be ${MAX_LOGO_BYTES / 1024} KB or smaller`);
  const type = detectLogoType(buffer);
  if (!type) throw new Error("The logo must be a PNG, JPEG or WebP image");
  return `data:${type};base64,${buffer.toString("base64")}`;
}

// What any signed-in user of the company (or the platform default) receives.
export function toBranding(company, logo = null) {
  const branding = { ...DEFAULT_BRANDING, ...(company?.branding || {}) };
  return {
    companyId: company?.id || null,
    name: company?.name || "",
    description: company?.description || "",
    ...branding,
    displayName: branding.displayName || company?.name || "",
    logo: logo || null
  };
}
