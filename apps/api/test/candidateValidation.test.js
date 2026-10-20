import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCandidateInput } from "../src/utils/candidateValidation.js";

const valid = { name: " Ada Lovelace ", email: "ADA@Example.com", role: "Engineer" };

test("create: requires name, email and role", () => {
  const { errors } = validateCandidateInput({});
  assert.deepEqual(errors, ["name is required", "email is required", "role is required"]);
});

test("create: trims, lowercases email and drops unknown fields", () => {
  const { value, errors } = validateCandidateInput({ ...valid, isAdmin: true, _id: "x", passwordHash: "y" });
  assert.equal(errors, undefined);
  assert.deepEqual(value, { name: "Ada Lovelace", email: "ada@example.com", role: "Engineer" });
});

test("rejects bad body types", () => {
  for (const body of [null, "x", 5, [], undefined]) {
    assert.ok(validateCandidateInput(body).errors, String(body));
  }
});

test("rejects invalid email, status, score, experience", () => {
  const cases = [
    [{ ...valid, email: "nope" }, /valid email/],
    [{ ...valid, status: "all" }, /status must be one of/],
    [{ ...valid, status: "admin" }, /status must be one of/],
    [{ ...valid, score: 101 }, /score/],
    [{ ...valid, score: -1 }, /score/],
    [{ ...valid, score: null }, /score/],
    [{ ...valid, experienceYears: "abc" }, /experienceYears/]
  ];
  for (const [body, pattern] of cases) {
    const { errors } = validateCandidateInput(body);
    assert.ok(errors?.some((e) => pattern.test(e)), JSON.stringify(body));
  }
});

test("accepts numeric strings for score and experience", () => {
  const { value } = validateCandidateInput({ ...valid, score: "88", experienceYears: "4" });
  assert.equal(value.score, 88);
  assert.equal(value.experienceYears, 4);
});

test("enforces length limits and non-string fields", () => {
  assert.ok(validateCandidateInput({ ...valid, name: "x".repeat(121) }).errors);
  assert.ok(validateCandidateInput({ ...valid, name: { $ne: "" } }).errors, "NoSQL operator object rejected");
  assert.ok(validateCandidateInput({ ...valid, summary: "x".repeat(2001) }).errors);
  assert.ok(validateCandidateInput({ ...valid, name: "   " }).errors);
});

test("skills must be a bounded array of non-empty strings", () => {
  assert.deepEqual(validateCandidateInput({ ...valid, skills: [" Vue ", "Node"] }).value.skills, ["Vue", "Node"]);
  assert.ok(validateCandidateInput({ ...valid, skills: "Vue" }).errors);
  assert.ok(validateCandidateInput({ ...valid, skills: [1] }).errors);
  assert.ok(validateCandidateInput({ ...valid, skills: Array(51).fill("a") }).errors);
});

test("update (partial): any subset allowed, empty object allowed", () => {
  assert.deepEqual(validateCandidateInput({}, { partial: true }).value, {});
  assert.deepEqual(validateCandidateInput({ status: "offer" }, { partial: true }).value, { status: "offer" });
  assert.ok(validateCandidateInput({ status: "bogus" }, { partial: true }).errors);
});

test("notes: validated, id stripped, defaults author, keeps createdAt as a date", () => {
  const { value } = validateCandidateInput(
    { notes: [{ text: " hi ", _id: "abc", createdAt: "2026-01-02T03:04:05.000Z" }] },
    { partial: true }
  );
  assert.equal(value.notes[0].text, "hi");
  assert.equal(value.notes[0].author, "Recruiter");
  assert.equal(value.notes[0]._id, undefined);
  assert.ok(value.notes[0].createdAt instanceof Date);
  assert.ok(validateCandidateInput({ notes: [{}] }, { partial: true }).errors);
  assert.ok(validateCandidateInput({ notes: "x" }, { partial: true }).errors);
});

test("interviews: all five fields required", () => {
  const interview = { title: "Tech", date: "2026-10-20", time: "14:00", interviewer: "Dave", type: "Video" };
  assert.deepEqual(validateCandidateInput({ interviews: [interview] }, { partial: true }).value.interviews, [interview]);
  assert.ok(validateCandidateInput({ interviews: [{ ...interview, time: undefined }] }, { partial: true }).errors);
});
