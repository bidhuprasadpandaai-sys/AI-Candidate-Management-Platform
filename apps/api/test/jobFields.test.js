import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENCY_CODES, EMPLOYMENT_TYPES, RATE_UNITS } from "@acmp/shared";
import { applyBlockReason, isExpired, isFull, todayUtc } from "../src/services/jobRules.js";
import { validateJobInput } from "../src/utils/jobValidation.js";

const base = { title: "Nurse" };
const ok = (body, options) => validateJobInput({ ...base, ...body }, options);

test("constants: two employment types, five rate units, a currency list", () => {
  assert.deepEqual(EMPLOYMENT_TYPES, ["full_time", "part_time"]);
  assert.deepEqual(RATE_UNITS, ["hour", "day", "week", "month", "year"]);
  assert.ok(CURRENCY_CODES.length >= 20 && CURRENCY_CODES.includes("USD") && CURRENCY_CODES.includes("INR"));
});

test("accepts every new field, normalising currency, rounding rates, and converting numeric strings", () => {
  const { value, errors } = ok({
    employmentType: "part_time", rateUnit: "day", currency: "eur",
    payRateMin: "40.456", payRateMax: 60, billRateMin: 70, billRateMax: "90",
    facilityId: "fac-12345678", expiresAt: "2030-06-30", maxApplications: "25"
  });
  assert.equal(errors, undefined);
  assert.deepEqual(value, {
    title: "Nurse", employmentType: "part_time", rateUnit: "day", currency: "EUR",
    payRateMin: 40.46, payRateMax: 60, billRateMin: 70, billRateMax: 90,
    facilityId: "fac-12345678", expiresAt: "2030-06-30", maxApplications: 25
  });
});

test("blank or null clears optional fields", () => {
  const { value } = ok({ currency: "", payRateMin: null, billRateMax: "", facilityId: null, expiresAt: "", maxApplications: null });
  assert.deepEqual(value, { title: "Nurse", currency: null, payRateMin: null, billRateMax: null, facilityId: null, expiresAt: null, maxApplications: null });
});

test("rejects bad values with a clear message", () => {
  const bad = (body, pattern) => assert.ok(ok(body).errors?.some((e) => pattern.test(e)), JSON.stringify(body));
  bad({ employmentType: "contract" }, /employmentType/);
  bad({ rateUnit: "fortnight" }, /rateUnit/);
  bad({ currency: "XXX" }, /currency/);
  bad({ currency: 5 }, /currency/);
  bad({ payRateMin: -1 }, /payRateMin/);
  bad({ billRateMax: "lots" }, /billRateMax/);
  bad({ payRateMax: 1e9 }, /payRateMax/);
  bad({ payRateMin: 50, payRateMax: 40 }, /pay rate minimum/);
  bad({ billRateMin: 90, billRateMax: 80 }, /bill rate minimum/);
  bad({ expiresAt: "2026-13-45" }, /expiresAt/);
  bad({ expiresAt: "2026-02-30" }, /expiresAt/);
  bad({ expiresAt: "tomorrow" }, /expiresAt/);
  bad({ expiresAt: 20261231 }, /expiresAt/);
  bad({ maxApplications: 0 }, /maxApplications/);
  bad({ maxApplications: 1.5 }, /maxApplications/);
  bad({ maxApplications: 100001 }, /maxApplications/);
  bad({ facilityId: { $ne: "" } }, /facilityId/);
});

test("min equal to max is fine; only one of min or max is fine", () => {
  assert.equal(ok({ payRateMin: 50, payRateMax: 50 }).errors, undefined);
  assert.equal(ok({ payRateMin: 50 }).errors, undefined);
  assert.equal(ok({ billRateMax: 99 }).errors, undefined);
});

test("expiry: a job expires the day after its date; today is still open", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  assert.equal(todayUtc(now), "2026-10-15");
  assert.equal(isExpired({ expiresAt: "2026-10-15" }, now), false);
  assert.equal(isExpired({ expiresAt: "2026-10-14" }, now), true);
  assert.equal(isExpired({ expiresAt: null }, now), false);
  assert.equal(isExpired({}, now), false);
});

test("full: only when a limit is set and reached", () => {
  assert.equal(isFull({ maxApplications: 3 }, 2), false);
  assert.equal(isFull({ maxApplications: 3 }, 3), true);
  assert.equal(isFull({ maxApplications: 3 }, 9), true);
  assert.equal(isFull({ maxApplications: null }, 999), false);
  assert.equal(isFull({}, 999), false);
});

test("applyBlockReason explains why nobody can be added", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const open = { status: "open", expiresAt: "2026-12-01", maxApplications: 2 };
  assert.equal(applyBlockReason(open, 1, now), null);
  assert.equal(applyBlockReason({ ...open, status: "closed" }, 0, now), "This job is closed");
  assert.match(applyBlockReason({ ...open, status: "draft" }, 0, now), /still a draft/);
  assert.match(applyBlockReason({ ...open, status: "on_hold" }, 0, now), /on hold/);
  assert.match(applyBlockReason({ ...open, expiresAt: "2026-10-01" }, 0, now), /expired on 2026-10-01/);
  assert.match(applyBlockReason(open, 2, now), /maximum of 2 applications/);
  assert.match(applyBlockReason({ ...open, maxApplications: 1 }, 1, now), /maximum of 1 application$/);
  assert.equal(applyBlockReason({ status: "open" }, 500, now), null, "no limit, no expiry");
});
