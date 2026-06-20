import "server-only";

import {
  candidateBriefSchema,
  type CandidateBriefDto,
} from "@prelude/contracts";

export type CandidateBriefRecord = {
  candidateSessionId: string;
  limitations: unknown;
  status: string;
  summaryJson: unknown;
};

export type CriteriaDistribution = Record<
  CandidateBriefDto["criteria"][number]["status"],
  number
>;

export type CandidateReviewSignals = {
  criteriaDistribution: CriteriaDistribution;
  hasCompletedBrief: boolean;
  limitationsCount: number;
  pointsToClarifyCount: number | null;
};

export function toCandidateBriefDto(
  brief: CandidateBriefRecord | null,
): CandidateBriefDto | null {
  if (!brief) {
    return null;
  }

  const parsed = candidateBriefSchema.safeParse(brief.summaryJson);
  if (parsed.success) {
    return parsed.data;
  }

  const fallback = candidateBriefSchema.safeParse({
    candidateSessionId: brief.candidateSessionId,
    limitations: readStringArray(brief.limitations),
    status: brief.status,
  });

  return fallback.success ? fallback.data : null;
}

export function getCandidateReviewSignals(
  brief: CandidateBriefDto | null,
): CandidateReviewSignals {
  const criteriaDistribution = emptyCriteriaDistribution();

  if (!brief) {
    return {
      criteriaDistribution,
      hasCompletedBrief: false,
      limitationsCount: 0,
      pointsToClarifyCount: null,
    };
  }

  for (const criterion of brief.criteria) {
    criteriaDistribution[criterion.status] += 1;
  }

  return {
    criteriaDistribution,
    hasCompletedBrief: brief.status === "completed",
    limitationsCount: brief.limitations.length,
    pointsToClarifyCount: brief.pointsToClarify.length,
  };
}

function emptyCriteriaDistribution(): CriteriaDistribution {
  return {
    "Not assessable": 0,
    Medium: 0,
    Strong: 0,
    Weak: 0,
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
