import { CANDIDATE_STATUSES } from "@acmp/shared";

const STATUSES = CANDIDATE_STATUSES.filter((status) => status !== "all");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  name: 120,
  email: 254,
  role: 120,
  stage: 120,
  location: 120,
  summary: 2000,
  skill: 60,
  maxSkills: 50,
  noteText: 2000,
  maxNotes: 500,
  interviewField: 120,
  maxInterviews: 100
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value, field, max, errors, { required = false, allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed && (required || !allowEmpty)) {
    errors.push(`${field} must not be empty`);
    return undefined;
  }
  if (trimmed.length > max) {
    errors.push(`${field} must be at most ${max} characters`);
    return undefined;
  }
  return trimmed;
}

function number(value, field, { min, max }, errors) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    errors.push(`${field} must be a number between ${min} and ${max}`);
    return undefined;
  }
  return parsed;
}

function validateNotes(value, errors) {
  if (!Array.isArray(value) || value.length > LIMITS.maxNotes) {
    errors.push(`notes must be an array of at most ${LIMITS.maxNotes} items`);
    return undefined;
  }
  const notes = [];
  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`notes[${index}] must be an object`);
      return;
    }
    const noteText = text(item.text, `notes[${index}].text`, LIMITS.noteText, errors, { required: true });
    const author = item.author === undefined ? "Recruiter" : text(item.author, `notes[${index}].author`, LIMITS.name, errors, { required: true });
    const note = { author, text: noteText };
    if (item.createdAt !== undefined) {
      const date = new Date(item.createdAt);
      if (Number.isNaN(date.getTime())) {
        errors.push(`notes[${index}].createdAt must be a valid date`);
      } else {
        note.createdAt = date;
      }
    }
    notes.push(note);
  });
  return notes;
}

function validateInterviews(value, errors) {
  if (!Array.isArray(value) || value.length > LIMITS.maxInterviews) {
    errors.push(`interviews must be an array of at most ${LIMITS.maxInterviews} items`);
    return undefined;
  }
  const interviews = [];
  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`interviews[${index}] must be an object`);
      return;
    }
    const interview = {};
    for (const field of ["title", "date", "time", "interviewer", "type"]) {
      interview[field] = text(item[field], `interviews[${index}].${field}`, LIMITS.interviewField, errors, { required: true });
    }
    interviews.push(interview);
  });
  return interviews;
}

// Validates and whitelists candidate fields. Unknown fields are dropped.
// `partial: true` (updates) allows any subset; otherwise name, email and role are required.
export function validateCandidateInput(body, { partial = false } = {}) {
  const errors = [];
  if (!isPlainObject(body)) {
    return { errors: ["Request body must be a JSON object"] };
  }

  const value = {};

  if (!partial) {
    for (const field of ["name", "email", "role"]) {
      if (body[field] === undefined) errors.push(`${field} is required`);
    }
  }

  if (body.name !== undefined) value.name = text(body.name, "name", LIMITS.name, errors, { required: true });
  if (body.role !== undefined) value.role = text(body.role, "role", LIMITS.role, errors, { required: true });
  if (body.email !== undefined) {
    const email = text(body.email, "email", LIMITS.email, errors, { required: true });
    if (email !== undefined) {
      if (EMAIL.test(email)) value.email = email.toLowerCase();
      else errors.push("email must be a valid email address");
    }
  }
  if (body.status !== undefined) {
    if (STATUSES.includes(body.status)) value.status = body.status;
    else errors.push(`status must be one of: ${STATUSES.join(", ")}`);
  }
  if (body.score !== undefined) value.score = number(body.score, "score", { min: 0, max: 100 }, errors);
  if (body.experienceYears !== undefined) {
    value.experienceYears = number(body.experienceYears, "experienceYears", { min: 0, max: 80 }, errors);
  }
  for (const field of ["stage", "location"]) {
    if (body[field] !== undefined) value[field] = text(body[field], field, LIMITS[field], errors, { required: true });
  }
  if (body.summary !== undefined) {
    value.summary = text(body.summary, "summary", LIMITS.summary, errors, { allowEmpty: true });
  }
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills) || body.skills.length > LIMITS.maxSkills) {
      errors.push(`skills must be an array of at most ${LIMITS.maxSkills} items`);
    } else {
      value.skills = body.skills
        .map((skill) => text(skill, "skills[]", LIMITS.skill, errors, { required: true }))
        .filter((skill) => skill !== undefined);
    }
  }
  if (body.notes !== undefined) value.notes = validateNotes(body.notes, errors);
  if (body.interviews !== undefined) value.interviews = validateInterviews(body.interviews, errors);

  if (errors.length > 0) {
    return { errors };
  }

  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return { value };
}
