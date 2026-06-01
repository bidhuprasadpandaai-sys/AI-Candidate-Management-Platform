export function formatTimestamp(dateValue) {
  if (!dateValue) {
    return "";
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const isSameDay = now.toDateString() === date.toDateString();

  if (isSameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function getInitials(name = "") {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function generateCandidateReply(candidateName = "Candidate", recruiterText = "") {
  const normalizedText = recruiterText.trim().toLowerCase();
  const firstName = String(candidateName).trim().split(/\s+/)[0] || "there";

  if (normalizedText.includes("interview")) {
    return `Hi, this is ${firstName}. Thanks for the update. I am available and would be happy to coordinate the interview details.`;
  }

  if (normalizedText.includes("offer")) {
    return `Thank you for sharing this, ${firstName} appreciates the opportunity. I would like to review the offer details and respond shortly.`;
  }

  if (normalizedText.includes("portfolio") || normalizedText.includes("resume")) {
    return `Thanks for the note. I can share any additional materials you need and answer follow-up questions.`;
  }

  return `Hi, this is ${firstName}. Thanks for reaching out. I appreciate the update and will get back to you soon.`;
}
