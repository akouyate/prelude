export const organizationRoles = [
  "owner",
  "admin",
  "recruiter",
  "viewer",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export const jobStatuses = ["draft", "active", "archived"] as const;

export type JobStatus = (typeof jobStatuses)[number];

export const interviewDraftStatuses = [
  "draft",
  "published",
  "archived",
] as const;

export type InterviewDraftStatus = (typeof interviewDraftStatuses)[number];

export const interviewStatuses = ["published", "paused", "archived"] as const;

export type InterviewStatus = (typeof interviewStatuses)[number];

export const candidateSessionStatuses = [
  "abandoned",
  "agent_joining",
  "completed",
  "consent_required",
  "created",
  "expired",
  "failed",
  "in_progress",
  "invited",
  "opened",
  "paused",
  "ready",
  "reconnecting",
  "started",
  "starting",
  "superseded",
  "waiting_candidate",
] as const;

export type CandidateSessionStatus = (typeof candidateSessionStatuses)[number];

export const candidateBriefStatuses = [
  "completed",
  "failed",
  "insufficient_signal",
  "partial",
  "pending",
  "processing",
  "technical_failure",
] as const;

export type CandidateBriefStatus = (typeof candidateBriefStatuses)[number];

export const recruiterReviewStatuses = [
  "to_review",
  "to_call",
  "archived",
] as const;

export type RecruiterReviewStatus = (typeof recruiterReviewStatuses)[number];

export function isCandidateBriefStatus(
  value: string | null | undefined,
): value is CandidateBriefStatus {
  return candidateBriefStatuses.includes(value as CandidateBriefStatus);
}

export function isRecruiterReviewStatus(
  value: string | null | undefined,
): value is RecruiterReviewStatus {
  return recruiterReviewStatuses.includes(value as RecruiterReviewStatus);
}
