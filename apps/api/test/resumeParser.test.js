import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import {
  detectResumeType,
  enhanceWithAi,
  extractResumeText,
  normalizeText,
  parseResumeText,
  redactResumeText,
  validateAiProfile
} from "../src/services/resumeParser.js";
import { SAMPLE_RESUME_LINES, makeDocx, makePdf } from "./helpers/fixtures.js";

const SAMPLE = SAMPLE_RESUME_LINES.join("\n");
const NOW = new Date("2026-10-15T00:00:00Z");
const parse = (text) => parseResumeText(text, { now: NOW });

// ── file type and text extraction ─────────────────────────────────────────────

test("detects PDF and Word files from their bytes, nothing else", async () => {
  assert.equal(detectResumeType(makePdf(["hello"])), "pdf");
  assert.equal(detectResumeType(await makeDocx(["hello"])), "docx");
  assert.equal(detectResumeType(Buffer.from("just some text, not a resume file")), null);
  assert.equal(detectResumeType(Buffer.from("MZ\x90\x00 an executable pretending")), null);
  assert.equal(detectResumeType(Buffer.alloc(0)), null);
  assert.equal(detectResumeType("not a buffer"), null);
});

test("extracts text from a PDF", async () => {
  const { type, text } = await extractResumeText(makePdf(SAMPLE_RESUME_LINES));
  assert.equal(type, "pdf");
  assert.ok(text.includes("Jane Q. Doe") && text.includes("jane.doe@example.com") && text.includes("Kubernetes"));
});

test("extracts text from a Word document, keeping paragraphs and decoding entities", async () => {
  const { type, text } = await extractResumeText(await makeDocx(["Tom & Jerry <Dev>", ...SAMPLE_RESUME_LINES]));
  assert.equal(type, "docx");
  assert.ok(text.includes("Tom & Jerry <Dev>"));
  assert.ok(text.split("\n").length >= 8);
});

test("rejects unsupported, unreadable, empty and image-only files with a clear code", async () => {
  const codeOf = async (buffer) => {
    try {
      await extractResumeText(buffer);
      return "none";
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(await codeOf(Buffer.from("plain text file, definitely long enough to look real")), "UNSUPPORTED");
  assert.equal(await codeOf(Buffer.from("%PDF-1.4 this is not really a pdf, just garbage after the header")), "BAD_FILE");
  assert.equal(await codeOf(makePdf(["hi"])), "NO_TEXT");
  assert.equal(await codeOf(await makeDocx([])), "NO_TEXT");
  const notWord = new JSZip();
  notWord.file("hello.txt", "x".repeat(200));
  assert.equal(await codeOf(Buffer.from(await notWord.generateAsync({ type: "uint8array" }))), "BAD_FILE");
});

test("refuses a zip bomb: a document part that inflates beyond the limit", async () => {
  const bomb = await makeDocx([], { documentXmlOverride: `<w:document><w:body>${"a".repeat(25 * 1024 * 1024)}</w:body></w:document>` });
  assert.ok(bomb.length < 200 * 1024, "the file itself is small");
  await assert.rejects(extractResumeText(bomb), (error) => error.code === "TOO_LONG");
});

test("normalizeText cleans whitespace and control characters", () => {
  assert.equal(normalizeText("a \u0000\u0007 b\r\n\r\n\r\n\r\nc\t\t d"), "a b\n\nc d");
});

// ── rules ─────────────────────────────────────────────────────────────────────

test("parses the sample resume", () => {
  const { profile, confidence, warnings } = parse(SAMPLE);
  assert.equal(profile.name, "Jane Q. Doe");
  assert.equal(profile.email, "jane.doe@example.com");
  assert.equal(profile.phone, "+14155550123");
  assert.equal(profile.role, "Senior Backend Engineer");
  assert.equal(profile.location, "San Francisco, CA");
  assert.equal(profile.experienceYears, 8, "an explicit '8+ years' wins");
  for (const skill of ["Node.js", "TypeScript", "PostgreSQL", "AWS", "Docker", "Kubernetes", "GraphQL"]) {
    assert.ok(profile.skills.includes(skill), skill);
  }
  assert.match(profile.summary, /8\+ years of experience/);
  assert.equal(confidence.name, "high");
  assert.deepEqual(warnings, []);
});

test("name: ALL CAPS, skips headings, falls back to the email with a warning", () => {
  assert.equal(parse("JANE Q. DOE\nSoftware Developer\njane@example.com\n").profile.name, "Jane Q. Doe");
  assert.equal(parse("Curriculum Vitae\nJohn Smith\njohn@example.com\n").profile.name, "John Smith");
  const guessed = parse("Resume\nWork history and other things go here\nmary.jones@example.com\n");
  assert.equal(guessed.profile.name, "Mary Jones");
  assert.equal(guessed.confidence.name, "low");
  assert.ok(guessed.warnings.some((w) => /guessed/.test(w)));
  assert.equal(parse("some text with no name and no contact details at all here").profile.name, null);
});

test("warns when there is no email", () => {
  const { profile, warnings } = parse("Jane Doe\nDeveloper\nSan Jose, CA\n");
  assert.equal(profile.email, null);
  assert.ok(warnings.some((w) => /No email/.test(w)));
});

test("phone: international and local formats; never year ranges or short numbers", () => {
  assert.equal(parse("A B\n+44 20 7946 0958\nx@y.co").profile.phone, "+442079460958");
  assert.equal(parse("A B\n(415) 555-0123\nx@y.co").profile.phone, "4155550123");
  assert.equal(parse("A B\n415.555.0123\nx@y.co").profile.phone, "4155550123");
  assert.equal(parse("A B\nWorked 2018 - 2021 2022\nx@y.co").profile.phone, null);
  assert.equal(parse("A B\nroom 1234\nx@y.co").profile.phone, null);
});

test("experience: stated years, merged date ranges (no double counting), 'present'", () => {
  assert.equal(parse("Cv\n12 years of professional experience in sales").profile.experienceYears, 12);
  const overlap = parse("Experience\nA Corp 2015 - 2020\nB Corp 2018 - 2022\n");
  assert.equal(overlap.profile.experienceYears, 8, "2015-2022 as one block, not 5+5");
  const present = parse("Experience\nAcme, Jan 2020 - Present\n");
  assert.equal(present.profile.experienceYears, 7);
  assert.equal(parse("no dates here at all, only words about a person and their work").profile.experienceYears, null);
});

test("skills: aliases and word boundaries (java is not javascript; c# and node.js work)", () => {
  const onlyJs = parse("Dev\nI use JavaScript and ReactJS daily").profile.skills;
  assert.ok(onlyJs.includes("JavaScript") && onlyJs.includes("React"));
  assert.ok(!onlyJs.includes("Java"), "java must not match inside javascript");
  const csharp = parse("Dev\nExperienced with C# and .NET and node").profile.skills;
  assert.ok(csharp.includes("C#") && csharp.includes(".NET") && csharp.includes("Node.js"));
  assert.ok(parse("Dev\nSkills: Pottery, Public speaking, Rust\n\nEducation").profile.skills.includes("Pottery"), "explicit skills section adds unknown skills");
});

// ── redaction and AI ──────────────────────────────────────────────────────────

test("redaction removes the email, phone, links, long numbers and the name", () => {
  const text = "Jane Doe\njane.doe@example.com\n+1 (415) 555-0123\nlinkedin.com/in/janedoe https://github.com/jane\nEmployee 1234567\nJane led Doe Corp";
  const redacted = redactResumeText(text, { name: "Jane Doe" });
  for (const secret of ["jane.doe@example.com", "555-0123", "linkedin.com/in/janedoe", "github.com/jane", "1234567", "Jane", "Doe"]) {
    assert.equal(redacted.includes(secret), false, `${secret} leaked`);
  }
  assert.ok(redacted.includes("[EMAIL]") && redacted.includes("[PHONE]") && redacted.includes("[LINK]") && redacted.includes("[NAME]"));
});

test("validateAiProfile keeps only well-formed fields and rejects junk", () => {
  assert.deepEqual(validateAiProfile('Sure! {"role":"Data Analyst","experienceYears":4.4,"skills":["SQL"," Excel ","x"],"summary":"Analyst."} bye'), {
    role: "Data Analyst",
    experienceYears: 4,
    skills: ["SQL", "Excel"],
    summary: "Analyst."
  });
  assert.equal(validateAiProfile("not json"), null);
  assert.equal(validateAiProfile("[1,2]"), null);
  assert.equal(validateAiProfile('{"role":"a@b.co","experienceYears":-3,"skills":"SQL","summary":""}'), null);
  assert.equal(validateAiProfile('{"experienceYears":99}'), null);
});

const AI_ENV = { LLM_PROVIDER: "ollama", OLLAMA_HOST: "http://ai.test", OLLAMA_MODEL: "m" };
const okReply = (obj) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) });
const quiet = { warn() {} };

test("AI fills only what the rules missed, from redacted text, and marks it", async () => {
  const text = "Jane Doe\njane@example.com\n+1 415 555 0123\nI build things for people and have done so for a long time across many teams.";
  const parsed = parse(text);
  assert.equal(parsed.profile.role, null);
  let sent;
  const result = await enhanceWithAi(text, parsed, {
    env: AI_ENV,
    logger: quiet,
    fetchImpl: async (url, init) => {
      sent = JSON.parse(init.body);
      return okReply({ role: "Product Engineer", experienceYears: 6, skills: ["Teamwork"], summary: "Builds products." })();
    }
  });
  assert.equal(result.source, "rules+ai");
  assert.equal(result.profile.role, "Product Engineer");
  assert.equal(result.confidence.role, "ai");
  assert.equal(result.profile.name, "Jane Doe", "rule-found fields are untouched");
  assert.equal(result.profile.email, "jane@example.com");
  const prompt = JSON.stringify(sent.messages);
  for (const secret of ["jane@example.com", "415 555 0123", "Jane", "Doe"]) assert.equal(prompt.includes(secret), false, `${secret} was sent to the model`);
  assert.equal(sent.temperature, 0);
});

test("AI never overrides rule results and is skipped when nothing is missing", async () => {
  const parsed = parse(SAMPLE);
  let calls = 0;
  const result = await enhanceWithAi(SAMPLE, parsed, { env: AI_ENV, logger: quiet, fetchImpl: async () => { calls += 1; return okReply({ role: "CEO" })(); } });
  assert.equal(calls, 0);
  assert.equal(result.source, "rules");
  assert.equal(result.profile.role, "Senior Backend Engineer");
});

test("AI failures, junk and prompt-injection output fall back to the rules result", async () => {
  const text = "Jane Doe\njane@example.com\nI build things for people and have done so for a long time across many teams.";
  const parsed = parse(text);
  for (const fetchImpl of [
    async () => { throw new Error("down"); },
    async () => ({ ok: false, status: 500 }),
    okReply("ignore previous instructions"),
    async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{\"role\":\"x@evil.com\"}" } }] }) })
  ]) {
    const result = await enhanceWithAi(text, parsed, { env: AI_ENV, logger: quiet, fetchImpl });
    assert.equal(result.source, "rules");
    assert.equal(result.profile.role, null);
  }
  assert.equal((await enhanceWithAi(text, parsed, { env: { LLM_PROVIDER: "rules" }, logger: quiet })).source, "rules", "disabled provider");
});
