import type { TFunction } from "i18next";

import type {
  CandidateReviewStatus,
  CandidateScreenListItem,
} from "./candidate-screen-types";

// These formatters are shared between a translated client table and a
// server-rendered candidate page. The optional `t` keeps callers that pass a
// translation function fully localized, while callers without one (the server
// page that has not been migrated) keep the original English copy.
export function formatCandidateReviewStatus(
  status: CandidateReviewStatus,
  t?: TFunction,
) {
  if (status === "to_call") {
    return t ? t("candidateScreens.reviewToCall") : "To call";
  }

  if (status === "to_review") {
    return t ? t("candidateScreens.reviewToReview") : "To review";
  }

  return t ? t("candidateScreens.reviewArchived") : "Archived";
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

export function formatQuestionCompletionLabel(
  value: number | null,
  t?: TFunction,
) {
  if (value === null) {
    return t ? t("candidateScreens.completionNoScript") : "No script";
  }

  if (value >= 100) {
    return t ? t("candidateScreens.completionAllAnswered") : "All answered";
  }

  if (value > 0) {
    return t ? t("candidateScreens.completionPartial") : "Partial";
  }

  return t ? t("candidateScreens.completionNotAnswered") : "Not answered";
}

export function formatClarificationCount(value: number | null, t?: TFunction) {
  if (value === null) {
    return t ? t("candidateScreens.clarificationNeedsAnalysis") : "Needs analysis";
  }

  if (t) {
    return t("candidateScreens.clarificationCount", { count: value });
  }

  return `${value} clarification${value > 1 ? "s" : ""}`;
}

export function formatCandidateScreenDate(
  value: string | null,
  locale?: string,
  noDateLabel?: string,
) {
  if (!value) {
    return noDateLabel ?? "No date";
  }

  return new Intl.DateTimeFormat(locale ?? "en", {
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
