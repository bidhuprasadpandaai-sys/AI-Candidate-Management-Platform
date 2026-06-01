export const CANDIDATE_STATUSES = [
  "all",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected"
];

export const STATUS_SEVERITY = {
  screening: "info",
  interview: "warning",
  offer: "success",
  hired: "success",
  rejected: "danger"
};

export function buildDashboardMetrics(candidates = []) {
  const totalCandidates = candidates.length;
  const shortlisted = candidates.filter((candidate) =>
    ["interview", "offer", "hired"].includes(candidate.status)
  ).length;
  const hired = candidates.filter(
    (candidate) => candidate.status === "hired"
  ).length;
  const averageScore = totalCandidates
    ? Math.round(
        candidates.reduce(
          (sum, candidate) => sum + Number(candidate.score || 0),
          0
        ) / totalCandidates
      )
    : 0;

  return {
    totalCandidates,
    shortlisted,
    hired,
    averageScore
  };
}

// Helper to find a candidate by name (fuzzy matching)
export function findCandidateByName(name = "", candidates = []) {
  if (!name) return null;
  const cleanName = name.trim().toLowerCase();
  
  // Try exact match first
  let match = candidates.find(c => c.name.toLowerCase() === cleanName);
  if (match) return match;
  
  // Try partial match (first name or last name)
  match = candidates.find(c => c.name.toLowerCase().includes(cleanName));
  if (match) return match;

  // Split search term and try to match parts
  const parts = cleanName.split(/\s+/);
  if (parts.length > 0) {
    match = candidates.find(c => {
      const candName = c.name.toLowerCase();
      return parts.every(part => candName.includes(part));
    });
  }
  
  return match || null;
}

export function parseAiMessage(message = "", candidates = []) {
  const text = message.trim();
  const lower = text.toLowerCase();

  // 1) Update Status Matchers
  // Match: "move [Ava] to [interview]"
  const moveRegex = /(?:move|change|update|set)\s+([A-Za-z\s]+?)\s+(?:status\s+)?to\s+(screening|interview|offer|hired|rejected)/i;
  let match = text.match(moveRegex);
  if (match) {
    const candidate = findCandidateByName(match[1], candidates);
    const targetStatus = match[2].toLowerCase();
    if (candidate) {
      return {
        command: "update_status",
        candidateId: candidate.id,
        candidateName: candidate.name,
        args: { status: targetStatus, stage: `${targetStatus.charAt(0).toUpperCase()}${targetStatus.slice(1)} stage` },
        reply: `🎯 **Action Executed:** I've updated **${candidate.name}**'s status to **${targetStatus.toUpperCase()}**.`
      };
    }
  }

  // Quick Action Matchers: "hire [Ava]" or "reject [Mason]"
  const hireRegex = /^(?:hire|onboard)\s+([A-Za-z\s]+)$/i;
  match = text.match(hireRegex);
  if (match) {
    const candidate = findCandidateByName(match[1], candidates);
    if (candidate) {
      return {
        command: "update_status",
        candidateId: candidate.id,
        candidateName: candidate.name,
        args: { status: "hired", stage: "Onboarding" },
        reply: `🎉 **Success:** **${candidate.name}** has been marked as **HIRED**! Welcome to the team.`
      };
    }
  }

  const rejectRegex = /^(?:reject|pass\s+on)\s+([A-Za-z\s]+)$/i;
  match = text.match(rejectRegex);
  if (match) {
    const candidate = findCandidateByName(match[1], candidates);
    if (candidate) {
      return {
        command: "update_status",
        candidateId: candidate.id,
        candidateName: candidate.name,
        args: { status: "rejected", stage: "Final decision" },
        reply: `⚠️ **Update:** **${candidate.name}**'s status has been changed to **REJECTED**.`
      };
    }
  }

  // 2) Add Note Matcher
  // Match: "add note to [Ava Thompson]: [Excellent React skills]" or "note for [Noah]: [ready to sign]"
  const noteRegex = /(?:add\s+)?note\s+(?:to|for)\s+([A-Za-z\s]+?):\s*(.+)/i;
  match = text.match(noteRegex);
  if (match) {
    const candidate = findCandidateByName(match[1], candidates);
    const noteText = match[2].trim();
    if (candidate) {
      return {
        command: "add_note",
        candidateId: candidate.id,
        candidateName: candidate.name,
        args: { text: noteText },
        reply: `📝 **Note Added:** Added a new note to **${candidate.name}**'s profile:\n*"${noteText}"*`
      };
    }
  }

  // 3) Schedule Interview Matcher
  // Match: "schedule technical interview for Ava Thompson on Friday at 3 PM with Alice"
  // Also accepts: round, session, call, meet as alternatives to 'interview'
  const interviewRegex = /schedule\s+(?:a\s+)?([A-Za-z\s]+?)\s+(?:interview|round|session|call|meet)\s+(?:with\s+)?for\s+([A-Za-z\s]+?)(?:\s+on\s+([A-Za-z0-9\s,/-]+?))?(?:\s+at\s+([a-z0-9\s:apmAPM]+?))?(?:\s+with\s+([A-Za-z\s]+?))?$/i;
  match = text.match(interviewRegex);

  // Fallback: try a simpler pattern if the above fails
  if (!match) {
    const simpleRegex = /schedule\s+(?:an?\s+)?(?:interview|round|session|call)\s+for\s+([A-Za-z\s]+?)(?:\s+on\s+([A-Za-z0-9\s,/-]+?))?(?:\s+at\s+([a-z0-9\s:apmAPM]+?))?(?:\s+with\s+([A-Za-z\s]+?))?$/i;
    const simpleMatch = text.match(simpleRegex);
    if (simpleMatch) {
      const candidate = findCandidateByName(simpleMatch[1], candidates);
      const date = simpleMatch[2] ? simpleMatch[2].trim() : "Next Monday";
      const time = simpleMatch[3] ? simpleMatch[3].trim() : "10:00 AM";
      const interviewer = simpleMatch[4] ? simpleMatch[4].trim() : "Hiring Panel";
      if (candidate) {
        return {
          command: "schedule_interview",
          candidateId: candidate.id,
          candidateName: candidate.name,
          args: {
            title: "Interview",
            type: "General",
            date,
            time,
            interviewer
          },
          reply: `📅 **Interview Scheduled:**\n- **Candidate:** ${candidate.name}\n- **Date & Time:** ${date} at ${time}\n- **Interviewer:** ${interviewer}`
        };
      }
    }
  }

  if (match) {
    const interviewType = match[1].trim();
    const candidate = findCandidateByName(match[2], candidates);
    const date = match[3] ? match[3].trim() : "Next Monday";
    const time = match[4] ? match[4].trim() : "10:00 AM";
    const interviewer = match[5] ? match[5].trim() : "Hiring Panel";

    if (candidate) {
      return {
        command: "schedule_interview",
        candidateId: candidate.id,
        candidateName: candidate.name,
        args: {
          title: `${interviewType} Interview`,
          type: interviewType,
          date,
          time,
          interviewer
        },
        reply: `📅 **Interview Scheduled:**\n- **Candidate:** ${candidate.name}\n- **Type:** ${interviewType}\n- **Date & Time:** ${date} at ${time}\n- **Interviewer:** ${interviewer}`
      };
    }
  }

  // 4) Summarize Candidate Matcher
  // Match: "summarize Ava Thompson" or "profile of Noah Patel"
  const summarizeRegex = /(?:summarize|profile\s+of|tell\s+me\s+about|look\s+up)\s+([A-Za-z\s]+)/i;
  match = text.match(summarizeRegex);
  if (match) {
    const candidate = findCandidateByName(match[1], candidates);
    if (candidate) {
      const skillsList = candidate.skills ? candidate.skills.join(", ") : "None specified";
      const notesList = candidate.notes && candidate.notes.length 
        ? candidate.notes.map(n => `- *${new Date(n.createdAt).toLocaleDateString() || 'Recent'}:* ${n.text}`).join("\n")
        : "No notes added yet.";
      
      const interviewsList = candidate.interviews && candidate.interviews.length
        ? candidate.interviews.map(i => `- **${i.title}** with *${i.interviewer}* on ${i.date} at ${i.time}`).join("\n")
        : "No interviews scheduled.";

      return {
        command: "summarize",
        candidateId: candidate.id,
        candidateName: candidate.name,
        reply: `👤 **Candidate Dossier: ${candidate.name}**\n\n` +
               `- **Role:** ${candidate.role}\n` +
               `- **Location:** ${candidate.location} | **Experience:** ${candidate.experienceYears} Years\n` +
               `- **Match Score:** ⭐️ **${candidate.score}/100**\n` +
               `- **Status:** \`${candidate.status.toUpperCase()}\` (${candidate.stage})\n` +
               `- **Skills:** ${skillsList}\n\n` +
               `📝 **Recruiter Notes:**\n${notesList}\n\n` +
               `📅 **Interviews:**\n${interviewsList}\n\n` +
               `*Summary: ${candidate.summary || "No profile bio available."}*`
      };
    }
  }

  return null;
}

export function generateAiReply(message = "", candidates = []) {
  // Check if it matches any interactive database commands first
  const parsed = parseAiMessage(message, candidates);
  if (parsed) {
    return parsed.reply;
  }

  const normalizedMessage = message.toLowerCase();
  const metrics = buildDashboardMetrics(candidates);

  if (normalizedMessage.includes("top") || normalizedMessage.includes("best")) {
    const topCandidates = [...candidates]
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
      .slice(0, 3);
    
    let text = "🏆 **Top matching candidates in your pipeline:**\n\n";
    topCandidates.forEach((cand, idx) => {
      text += `${idx + 1}. **${cand.name}** - ${cand.role} (*Score: ${cand.score}/100*, ${cand.experienceYears} yrs exp)\n`;
    });
    
    return topCandidates.length
      ? text
      : "No candidates are available yet. Seed the demo data to get started.";
  }

  if (
    normalizedMessage.includes("summary") ||
    normalizedMessage.includes("dashboard") ||
    normalizedMessage.includes("stats")
  ) {
    return `📊 **TalentOS Pipeline Summary:**\n\n` +
           `- **Total Candidates:** ${metrics.totalCandidates} profiles\n` +
           `- **Shortlisted:** ${metrics.shortlisted} (Interview/Offer/Hired)\n` +
           `- **Hires to date:** 🎉 ${metrics.hired}\n` +
           `- **Average Pipeline Match Score:** ⭐️ **${metrics.averageScore}%**`;
  }

  if (
    normalizedMessage.includes("offer") ||
    normalizedMessage.includes("hire") ||
    normalizedMessage.includes("close")
  ) {
    const readyForOffer = candidates.filter((candidate) =>
      ["offer", "hired"].includes(candidate.status)
    );
    
    let text = "✨ **Candidates closest to onboarding/closure:**\n\n";
    readyForOffer.forEach(cand => {
      text += `- **${cand.name}** (*${cand.role}*) - Currently in **${cand.status.toUpperCase()}** stage (${cand.stage})\n`;
    });

    return readyForOffer.length
      ? text
      : "No candidates are currently in offer or hired stages.";
  }

  return "👋 **TalentOS Recruiting Copilot** here!\n\nYou can ask me to:\n" +
         "- **Summarize the pipeline**: *\"Give me a dashboard summary\"*\n" +
         "- **Identify top talent**: *\"Who are the best candidates?\"*\n" +
         "- **Find candidate details**: *\"Summarize Sophia Nguyen\"*\n\n" +
         "🔒 **Database Action Commands:**\n" +
         "- **Change Status**: *\"Move Ava Thompson to offer\"* or *\"Hire Noah Patel\"*\n" +
         "- **Add Recruiter Notes**: *\"Note for Ava: Impressive coding skills!\"*\n" +
         "- **Schedule Rounds**: *\"Schedule Technical interview for Noah Patel on Monday at 2 PM with Dave\"*";
}
