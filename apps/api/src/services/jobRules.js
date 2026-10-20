// Rules that depend on a job's expiry date and application limit.

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

export const isExpired = (job, now = new Date()) => Boolean(job.expiresAt) && job.expiresAt < todayUtc(now);

export const isFull = (job, applicationCount) => Boolean(job.maxApplications) && applicationCount >= job.maxApplications;

// Why a candidate cannot be added to this job right now, or null when they can.
export function applyBlockReason(job, applicationCount, now = new Date()) {
  if (job.status === "closed") return "This job is closed";
  if (job.status !== "open") return `This job is ${job.status === "draft" ? "still a draft" : "on hold"} and is not taking applications`;
  if (isExpired(job, now)) return `This job expired on ${job.expiresAt}`;
  if (isFull(job, applicationCount)) return `This job has reached its maximum of ${job.maxApplications} application${job.maxApplications === 1 ? "" : "s"}`;
  return null;
}
