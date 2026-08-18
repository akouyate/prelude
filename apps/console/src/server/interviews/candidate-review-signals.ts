import "server-only";

import {
  candidateBriefSchema,
  type CandidateBriefDto,
} from "@prelude/contracts";

export type CandidateBriefRecord = {
  candidateSessionId: string;
  // The stamped generation language (plan 2026-08-18, rule 6). Nullable and
  // never backfilled: `null` means "generated before stamping existed".
  language?: string | null;
  limitations: unknown;
  status: string;
  summaryJson: unknown;
};

/**
 * The brief as the review page needs it: the parsed content PLUS the two facts
 * that live on the row rather than inside `summaryJson`.
 *
 * `toCandidateBriefDto` reads its status out of the stored JSON, and a failed
 * REGENERATION leaves the previous success's JSON untouched — so that status
 * keeps saying "completed" while the row says "failed". Reading only the DTO
 * therefore hides a failed regeneration behind stale content, which is exactly
 * what `regenerationFailed` exists to surface.
 */
export type CandidateBriefView = {
  content: CandidateBriefDto | null;
  language: string | null;
  regenerationFailed: boolean;
};

export function toCandidateBriefView(
  brief: CandidateBriefRecord | null,
): CandidateBriefView {
  if (!brief) {
    return { content: null, language: null, regenerationFailed: false };
  }

  // The PRIMARY parse only: it is what distinguishes "there is real previous
  // content to keep showing" from the synthesized fallback DTO a first-ever
  // failure produces out of the row's own columns. This leans on an invariant
  // enforced by the writers, not here: a successfully-written summaryJson can
  // never itself carry status "failed" (the OpenAI JSON schema pins the enum in
  // candidate-brief-openai.ts, and resolveLocalBriefStatus in
  // candidate-brief-generation.ts never returns it). If a synthesizer ever
  // legitimately emits "failed" on a fresh write, this flag would misfire.
  const parsedContent = candidateBriefSchema.safeParse(brief.summaryJson);

  return {
    content: toCandidateBriefDto(brief),
    language: brief.language ?? null,
    regenerationFailed: brief.status === "failed" && parsedContent.success,
  };
}

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
