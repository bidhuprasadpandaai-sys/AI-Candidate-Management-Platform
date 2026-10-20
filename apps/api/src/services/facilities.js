import crypto from "node:crypto";

// A facility is a work site of ONE company: name, location (city or area), street address and pin (postal) code.
export const FACILITY_LIMITS = { name: 80, location: 80, address: 200, pinCode: 12 };
export const MAX_FACILITIES = 50;
const PIN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,10}[A-Za-z0-9]$/;

// Returns { value, error }. Everything except the name is optional.
export function cleanFacility(item) {
  const text = (key) => (typeof item?.[key] === "string" ? item[key].trim() : item?.[key] === undefined || item?.[key] === null ? "" : null);
  const name = text("name");
  if (!name || name.length > FACILITY_LIMITS.name) return { error: "each facility needs a name of at most 80 characters" };
  const location = text("location");
  if (location === null || location.length > FACILITY_LIMITS.location) return { error: "location must be text of at most 80 characters" };
  const address = text("address");
  if (address === null || address.length > FACILITY_LIMITS.address) return { error: "address must be text of at most 200 characters" };
  const pinCode = text("pinCode");
  if (pinCode === null || (pinCode !== "" && !PIN.test(pinCode))) return { error: "pin code must be 3 to 12 letters, digits, spaces or dashes" };
  const id = typeof item.id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(item.id) ? item.id : crypto.randomUUID();
  return { value: { id, name, location, address, pinCode } };
}
