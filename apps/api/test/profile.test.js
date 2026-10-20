import assert from "node:assert/strict";
import { test } from "node:test";
import { profileCompleteness } from "@acmp/shared";

const full = {
  name: "Jane Doe", email: "jane@example.com", phone: "+14155550123", role: "Engineer", location: "Austin, TX",
  experienceYears: 6, skills: ["Node.js", "AWS", "Docker"], summary: "Backend engineer who builds reliable APIs for fast growing teams.", resumeId: "r1"
};

test("a fully filled profile scores 100 with nothing missing", () => {
  const result = profileCompleteness(full);
  assert.equal(result.score, 100);
  assert.equal(result.level, "complete");
  assert.deepEqual(result.missing, []);
  assert.equal(result.items.reduce((sum, item) => sum + item.weight, 0), 100, "weights add up to 100");
});

test("an empty or missing candidate scores 0 and lists everything", () => {
  assert.equal(profileCompleteness({}).score, 0);
  assert.equal(profileCompleteness(null).score, 0);
  assert.equal(profileCompleteness(undefined).missing.length, 9);
  assert.equal(profileCompleteness({}).level, "started");
});

test("only the basics: name, email and role", () => {
  const result = profileCompleteness({ name: "A B", email: "a@b.co", role: "Dev" });
  assert.equal(result.score, 30);
  assert.deepEqual(result.missing.map((m) => m.key), ["phone", "location", "experienceYears", "skills", "summary", "resume"]);
  assert.equal(result.level, "started");
});

test("skills earn partial credit below three", () => {
  assert.equal(profileCompleteness({ skills: ["a"] }).score, 5);
  assert.equal(profileCompleteness({ skills: ["a", "b"] }).score, 10);
  assert.equal(profileCompleteness({ skills: ["a", "b", "c", "d"] }).score, 15);
  assert.equal(profileCompleteness({ skills: "not an array" }).score, 0);
});

test("a too-short summary, blank strings and zero years do not count", () => {
  assert.equal(profileCompleteness({ summary: "Short." }).score, 0);
  assert.equal(profileCompleteness({ name: "   ", email: "", phone: "\n" }).score, 0);
  assert.equal(profileCompleteness({ experienceYears: 0 }).score, 0);
  assert.equal(profileCompleteness({ experienceYears: "7" }).score, 10);
});

test("levels follow the score", () => {
  assert.equal(profileCompleteness({ ...full, resumeId: null, phone: "" }).level, "good");
  assert.equal(profileCompleteness({ name: "A", email: "a@b.co", role: "R", phone: "123456789", skills: ["x"] }).level, "partial");
  assert.equal(profileCompleteness({ ...full, summary: "", resumeId: null }).level, "good");
});
