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

export const interviewStatuses = [
  "published",
  "paused",
  "archived",
] as const;

export type InterviewStatus = (typeof interviewStatuses)[number];

export const candidateSessionStatuses = [
  "created",
  "started",
  "waiting_candidate",
  "agent_joining",
  "in_progress",
  "paused",
  "completed",
  "failed",
  "expired",
  "abandoned",
] as const;

export type CandidateSessionStatus = (typeof candidateSessionStatuses)[number];

export const candidateBriefStatuses = [
  "pending",
  "processing",
  "completed",
  "failed",
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
