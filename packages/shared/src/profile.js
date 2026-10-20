// How complete a candidate's profile is (0-100), and what is still missing.
// Pure and deterministic: the same rule is used by the API and by the web app.

const ITEMS = [
  { key: "name", label: "Name", weight: 10, earned: (c) => (hasText(c.name) ? 1 : 0) },
  { key: "email", label: "Email", weight: 10, earned: (c) => (hasText(c.email) ? 1 : 0) },
  { key: "phone", label: "Phone number", weight: 10, earned: (c) => (hasText(c.phone) ? 1 : 0) },
  { key: "role", label: "Role or title", weight: 10, earned: (c) => (hasText(c.role) ? 1 : 0) },
  { key: "location", label: "Location", weight: 5, earned: (c) => (hasText(c.location) ? 1 : 0) },
  { key: "experienceYears", label: "Years of experience", weight: 10, earned: (c) => (Number(c.experienceYears) > 0 ? 1 : 0) },
  // three or more skills is a full profile; fewer earns partial credit
  { key: "skills", label: "Skills (3 or more)", weight: 15, earned: (c) => Math.min((Array.isArray(c.skills) ? c.skills.length : 0) / 3, 1) },
  { key: "summary", label: "Summary (a sentence or two)", weight: 15, earned: (c) => (hasText(c.summary) && String(c.summary).trim().length >= 40 ? 1 : 0) },
  { key: "resume", label: "Resume on file", weight: 15, earned: (c) => (c.resumeId ? 1 : 0) }
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function profileCompleteness(candidate) {
  const source = candidate || {};
  const items = ITEMS.map((item) => {
    const fraction = item.earned(source);
    return { key: item.key, label: item.label, weight: item.weight, earned: Math.round(item.weight * fraction * 10) / 10, complete: fraction >= 1 };
  });
  const score = Math.round(items.reduce((sum, item) => sum + item.earned, 0));
  return {
    score,
    level: score >= 85 ? "complete" : score >= 60 ? "good" : score >= 35 ? "partial" : "started",
    missing: items.filter((item) => !item.complete).map((item) => ({ key: item.key, label: item.label })),
    items
  };
}

export const PROFILE_LEVEL_LABELS = {
  complete: "Complete",
  good: "Good",
  partial: "Partial",
  started: "Just started"
};
