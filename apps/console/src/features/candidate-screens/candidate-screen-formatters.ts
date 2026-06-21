import type {
  CandidateReviewStatus,
  CandidateScreenListItem,
} from "./candidate-screen-types";

export function formatCandidateReviewStatus(status: CandidateReviewStatus) {
  if (status === "to_call") {
    return "To call";
  }

  if (status === "to_review") {
    return "To review";
  }

  return "Archived";
}

export function candidateReviewStatusTone(status: CandidateReviewStatus) {
  if (status === "to_call") {
    return "success";
  }

  if (status === "archived") {
    return "muted";
  }

  return "danger";
}

export function candidateReviewRank(status: CandidateReviewStatus) {
  if (status === "to_review") {
    return 0;
  }

  if (status === "to_call") {
    return 1;
  }

  return 2;
}

export function formatQuestionCompletionLabel(value: number | null) {
  if (value === null) {
    return "No script";
  }

  if (value >= 100) {
    return "All answered";
  }

  if (value > 0) {
    return "Partial";
  }

  return "Not answered";
}

export function formatClarificationCount(value: number | null) {
  if (value === null) {
    return "Needs analysis";
  }

  return `${value} clarification${value > 1 ? "s" : ""}`;
}

export function formatCandidateScreenDate(value: string | null) {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function formatCandidateScreenStatus(status: string) {
  return status.replace(/_/g, " ");
}

export function initialsForCandidate(value: string) {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "C";
}

export function candidateScreenMatchesQuery(
  candidate: CandidateScreenListItem,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [candidate.candidateLabel, candidate.roleTitle, candidate.jobTitle]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function isCandidateScreenInProgress(status: string) {
  return (
    status === "agent_joining" ||
    status === "created" ||
    status === "in_progress" ||
    status === "paused" ||
    status === "started" ||
    status === "waiting_candidate"
  );
}
