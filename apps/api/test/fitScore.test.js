import assert from "node:assert/strict";
import { test } from "node:test";
import { FIT_WEIGHTS, computeFit, explainFit, levelFor, requiredYears } from "../src/services/fitScore.js";
import { canonicalSkill, extractKnownSkills } from "../src/services/resumeParser.js";

const fullProfile = {
  name: "Jane Doe", email: "jane@example.com", phone: "+14155550123", role: "Senior Backend Engineer", location: "Remote",
  experienceYears: 8, skills: ["Node.js", "AWS", "Docker"], summary: "Backend engineer who builds reliable APIs for fast growing teams.", resumeId: "r1"
};
const job = {
  title: "Senior Backend Engineer",
  description: "We need 5+ years of experience building APIs with Node.js, AWS and Docker.",
  location: ""
};
const factor = (fit, key) => fit.breakdown.find((f) => f.key === key);

test("weights add up to 100 and levels follow the score", () => {
  assert.equal(Object.values(FIT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(levelFor(100).key, "strong");
  assert.equal(levelFor(75).key, "strong");
  assert.equal(levelFor(74).key, "good");
  assert.equal(levelFor(60).key, "good");
  assert.equal(levelFor(59).key, "partial");
  assert.equal(levelFor(40).key, "partial");
  assert.equal(levelFor(39).key, "weak");
  assert.equal(levelFor(0).key, "weak");
});

test("a candidate who matches everything scores 100", () => {
  const fit = computeFit({ candidate: fullProfile, job });
  assert.equal(fit.score, 100);
  assert.equal(fit.level, "strong");
  assert.deepEqual(fit.matchedSkills.sort(), ["AWS", "Docker", "Node.js"]);
  assert.deepEqual(fit.missingSkills, []);
  assert.equal(fit.requiredYears, 5);
  assert.deepEqual(fit.warnings, []);
  assert.match(fit.explanation, /Strong fit for "Senior Backend Engineer"/);
  assert.match(fit.explanation, /3 of 3 required skills/);
});

test("missing skills lower the score and are listed", () => {
  const fit = computeFit({
    candidate: { ...fullProfile, skills: ["Node.js"] },
    job: { ...job, description: "5+ years. Node.js, AWS, Docker, Kubernetes and GraphQL." }
  });
  assert.deepEqual(fit.matchedSkills, ["Node.js"]);
  assert.deepEqual(fit.missingSkills.sort(), ["AWS", "Docker", "GraphQL", "Kubernetes"]);
  assert.equal(factor(fit, "skills").score, 20);
  assert.ok(fit.score < 75 && fit.score > 40, `score ${fit.score}`);
  assert.match(fit.explanation, /missing/i);
});

test("skills written differently still match (aliases) and the summary and role count as evidence", () => {
  assert.equal(canonicalSkill("nodejs"), "Node.js");
  assert.equal(canonicalSkill(" K8S "), "Kubernetes");
  assert.equal(canonicalSkill("Underwater basket weaving"), "Underwater basket weaving");
  const fit = computeFit({
    candidate: { ...fullProfile, skills: ["nodejs"], summary: "I run Kubernetes clusters on AWS every day, and mentor others." },
    job: { ...job, description: "Node.js, AWS and Kubernetes required." }
  });
  assert.deepEqual(fit.matchedSkills.sort(), ["AWS", "Kubernetes", "Node.js"]);
});

test("the resume adds skills, a role and years that the profile lacks", () => {
  const bare = { name: "Sam", email: "s@x.co", role: "", skills: [], experienceYears: 0, location: "Remote" };
  const without = computeFit({ candidate: bare, job });
  const withResume = computeFit({
    candidate: { ...bare, resumeId: "r1" },
    resume: { parsed: { skills: ["Node.js", "AWS", "Docker"], role: "Senior Backend Engineer", experienceYears: 9 } },
    job
  });
  assert.equal(without.matchedSkills.length, 0);
  assert.equal(withResume.matchedSkills.length, 3);
  assert.equal(withResume.candidateYears, 9);
  assert.equal(factor(withResume, "title").score, 100);
  assert.equal(withResume.usedResume, true);
  assert.ok(withResume.score > without.score + 30);
  const preferProfile = computeFit({ candidate: { ...bare, experienceYears: 2 }, resume: { parsed: { experienceYears: 9 } }, job });
  assert.equal(preferProfile.candidateYears, 2, "the reviewed profile value wins over the resume");
});

test("experience: requirement met, partly met, stated nowhere", () => {
  assert.equal(requiredYears("Minimum 3 years of experience; 7+ yrs preferred"), 7);
  assert.equal(requiredYears("401k and 24/7 support"), null);
  assert.equal(requiredYears("Founded 120 years ago"), null);
  assert.equal(requiredYears("no numbers here"), null);
  const half = computeFit({ candidate: { ...fullProfile, experienceYears: 3 }, job: { ...job, description: "6+ years. Node.js" } });
  assert.equal(factor(half, "experience").score, 50);
  assert.match(factor(half, "experience").detail, /3 years of experience against 6/);
  const none = computeFit({ candidate: fullProfile, job: { ...job, description: "Node.js" } });
  assert.equal(factor(none, "experience").score, 80);
  assert.equal(factor(computeFit({ candidate: { ...fullProfile, experienceYears: 0 }, job: { ...job, description: "Node.js" } }), "experience").score, 60);
});

test("role match uses synonyms and ignores filler words", () => {
  const fit = (role, title) => factor(computeFit({ candidate: { ...fullProfile, role }, job: { ...job, title } }), "title").score;
  assert.equal(fit("Software Developer", "Software Engineer"), 100);
  assert.equal(fit("Senior Backend Engineer", "Senior Backend Engineer"), 100);
  assert.equal(fit("Backend Engineer", "Senior Backend Engineer"), 67);
  assert.equal(fit("Marketing Manager", "Senior Backend Engineer"), 0);
  assert.equal(fit("", "Senior Backend Engineer"), 0);
});

test("location: remote and empty always match; same place matches; far away is low", () => {
  const loc = (candidateLocation, jobLocation) => factor(computeFit({ candidate: { ...fullProfile, location: candidateLocation }, job: { ...job, location: jobLocation } }), "location").score;
  assert.equal(loc("Paris, France", ""), 100);
  assert.equal(loc("Paris, France", "Remote (EU)"), 100);
  assert.equal(loc("Austin, TX", "Austin, TX"), 100);
  assert.equal(loc("Austin, TX", "Dallas, TX"), 100, "same state counts");
  assert.equal(loc("Remote", "Berlin, Germany"), 50);
  assert.equal(loc("", "Berlin, Germany"), 50);
  assert.equal(loc("Tokyo, Japan", "Berlin, Germany"), 30);
});

test("a job without a description is scored on title and location, with a clear warning", () => {
  const fit = computeFit({ candidate: fullProfile, job: { title: "Senior Backend Engineer", description: "", location: "" } });
  assert.equal(factor(fit, "skills").score, 50);
  assert.ok(fit.warnings.some((w) => /no description/i.test(w)));
  const noSkills = computeFit({ candidate: fullProfile, job: { title: "Office Manager", description: "Keep the office running smoothly and welcome visitors." } });
  assert.ok(noSkills.warnings.some((w) => /No known skills/.test(w)));
  const noCandidateSkills = computeFit({ candidate: { ...fullProfile, skills: [], summary: "" }, job });
  assert.ok(noCandidateSkills.warnings.some((w) => /no skills on file/i.test(w)));
});

test("profile completeness feeds the score; the score is always 0-100 and explained", () => {
  const complete = computeFit({ candidate: fullProfile, job });
  const sparse = computeFit({ candidate: { ...fullProfile, phone: "", summary: "", resumeId: null }, job });
  assert.ok(complete.score > sparse.score);
  assert.match(factor(sparse, "profile").detail, /Missing: phone number, summary/i);
  for (const candidate of [{}, fullProfile, { skills: ["x"] }]) {
    const { score, breakdown } = computeFit({ candidate, job });
    assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
    assert.equal(breakdown.length, 5);
    for (const f of breakdown) assert.ok(f.score >= 0 && f.score <= 100 && f.detail.length > 0);
  }
});

test("known skills are found in free text with word boundaries", () => {
  assert.deepEqual(extractKnownSkills("We use JavaScript, plus React and C#").sort(), ["C#", "JavaScript", "React"]);
  assert.ok(extractKnownSkills("Java and Kotlin").includes("Java"));
  assert.deepEqual(extractKnownSkills(""), []);
});

// ── optional AI wording ───────────────────────────────────────────────────────

const AI = { LLM_PROVIDER: "ollama", OLLAMA_HOST: "http://ai.test", OLLAMA_MODEL: "m" };
const quiet = { warn() {} };
const reply = (text) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });

test("AI wording: disabled provider returns null; enabled returns text and is cached", async () => {
  const fit = computeFit({ candidate: fullProfile, job: { ...job, title: "Cache Test Engineer" } });
  assert.equal(await explainFit(fit, { title: "Cache Test Engineer" }, { env: { LLM_PROVIDER: "rules" }, logger: quiet }), null);

  let calls = 0;
  let sent;
  const fetchImpl = async (url, init) => { calls += 1; sent = JSON.parse(init.body); return reply("A strong match for the role, missing nothing important.")(); };
  const first = await explainFit(fit, { title: "Cache Test Engineer" }, { env: AI, fetchImpl, logger: quiet });
  const second = await explainFit(fit, { title: "Cache Test Engineer" }, { env: AI, fetchImpl, logger: quiet });
  assert.equal(first.text, "A strong match for the role, missing nothing important.");
  assert.equal(second.text, first.text);
  assert.equal(calls, 1, "the second identical request is served from the cache");
  const prompt = JSON.stringify(sent.messages);
  for (const secret of ["Jane", "jane@example.com", "+14155550123"]) assert.equal(prompt.includes(secret), false, `${secret} was sent to the model`);
  assert.ok(prompt.includes("Cache Test Engineer") && prompt.includes("Node.js"));
});

test("AI wording: failures, empty and overlong replies fall back to null", async () => {
  const fit = computeFit({ candidate: fullProfile, job: { ...job, title: "Fallback Test Engineer" } });
  for (const fetchImpl of [async () => { throw new Error("down"); }, async () => ({ ok: false, status: 500 }), reply("   "), reply("x".repeat(500))]) {
    assert.equal(await explainFit(fit, { title: "Fallback Test Engineer" }, { env: AI, fetchImpl, logger: quiet }), null);
  }
});
