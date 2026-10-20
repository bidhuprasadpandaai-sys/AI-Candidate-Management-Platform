import { CURRENCY_CODES, EMPLOYMENT_TYPES, JOB_STATUSES, RATE_UNITS } from "@acmp/shared";

const LIMITS = { title: 120, department: 80, location: 120, description: 5000 };

function text(value, field, errors, { required = false } = {}) {
  if (typeof value !== "string") {
    errors.push(`${field} must be text`);
    return undefined;
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    errors.push(`${field} is required`);
    return undefined;
  }
  if (trimmed.length > LIMITS[field]) {
    errors.push(`${field} must be at most ${LIMITS[field]} characters`);
    return undefined;
  }
  return trimmed;
}

// Validates and whitelists job fields (companyId and createdBy are set by the server).
// hiringManagerId is returned as given (string or null); the route checks that the user exists.
export function validateJobInput(body, { partial = false } = {}) {
  const errors = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: ["Request body must be a JSON object"] };
  }
  const value = {};

  if (!partial && body.title === undefined) errors.push("title is required");
  if (body.title !== undefined) value.title = text(body.title, "title", errors, { required: true });
  for (const field of ["department", "location", "description"]) {
    if (body[field] !== undefined) value[field] = text(body[field], field, errors);
  }
  if (body.status !== undefined) {
    if (JOB_STATUSES.includes(body.status)) value.status = body.status;
    else errors.push(`status must be one of: ${JOB_STATUSES.join(", ")}`);
  }
  if (body.hiringManagerId !== undefined) {
    if (body.hiringManagerId === null || body.hiringManagerId === "") value.hiringManagerId = null;
    else if (typeof body.hiringManagerId === "string" && body.hiringManagerId.length <= 64) value.hiringManagerId = body.hiringManagerId;
    else errors.push("hiringManagerId must be a user id or null");
  }

  if (body.employmentType !== undefined) {
    if (EMPLOYMENT_TYPES.includes(body.employmentType)) value.employmentType = body.employmentType;
    else errors.push(`employmentType must be one of: ${EMPLOYMENT_TYPES.join(", ")}`);
  }
  if (body.rateUnit !== undefined) {
    if (RATE_UNITS.includes(body.rateUnit)) value.rateUnit = body.rateUnit;
    else errors.push(`rateUnit must be one of: ${RATE_UNITS.join(", ")}`);
  }
  if (body.currency !== undefined) {
    if (body.currency === null || body.currency === "") value.currency = null;
    else if (typeof body.currency === "string" && CURRENCY_CODES.includes(body.currency.toUpperCase())) value.currency = body.currency.toUpperCase();
    else errors.push("currency is not a supported currency code");
  }
  for (const field of ["payRateMin", "payRateMax", "billRateMin", "billRateMax"]) {
    if (body[field] === undefined) continue;
    if (body[field] === null || body[field] === "") {
      value[field] = null;
      continue;
    }
    const number = typeof body[field] === "string" && body[field].trim() !== "" ? Number(body[field]) : body[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 10000000) {
      errors.push(`${field} must be a number between 0 and 10,000,000`);
    } else {
      value[field] = Math.round(number * 100) / 100;
    }
  }
  if (body.facilityId !== undefined) {
    if (body.facilityId === null || body.facilityId === "") value.facilityId = null;
    else if (typeof body.facilityId === "string" && body.facilityId.length <= 64) value.facilityId = body.facilityId;
    else errors.push("facilityId must be a facility id or null");
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === "") {
      value.expiresAt = null;
    } else if (typeof body.expiresAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt) && !Number.isNaN(new Date(`${body.expiresAt}T00:00:00Z`).getTime()) && new Date(`${body.expiresAt}T00:00:00Z`).toISOString().startsWith(body.expiresAt)) {
      value.expiresAt = body.expiresAt;
    } else {
      errors.push("expiresAt must be a date like 2026-12-31");
    }
  }
  if (body.maxApplications !== undefined) {
    if (body.maxApplications === null || body.maxApplications === "") value.maxApplications = null;
    else {
      const count = typeof body.maxApplications === "string" ? Number(body.maxApplications) : body.maxApplications;
      if (!Number.isInteger(count) || count < 1 || count > 100000) errors.push("maxApplications must be a whole number from 1 to 100,000");
      else value.maxApplications = count;
    }
  }
  for (const kind of ["pay", "bill"]) {
    const min = value[`${kind}RateMin`];
    const max = value[`${kind}RateMax`];
    if (typeof min === "number" && typeof max === "number" && min > max) errors.push(`${kind} rate minimum cannot be higher than the maximum`);
  }

  if (errors.length > 0) return { errors };
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return { value };
}
