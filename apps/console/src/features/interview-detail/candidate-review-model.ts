import type { CandidateBriefDto } from "@prelude/contracts";

import { replayOffsetMs, replayOriginMs } from "./interview-replay";

export type ReviewCriterionStatus = "missing" | "partial" | "strong";

export type ReviewCriterion = {
  askOnNextCall: string[];
  id: string;
  label: string;
  note: string;
  quote: string | null;
  startMs: number | null;
  status: ReviewCriterionStatus;
};

type ReplayTurn = {
  endedAt: string | null;
  questionId: string | null;
  startedAt: string;
  turnId: string;
};

// The review page splits every criterion into "confirmed by the interview" and
// "needs a second look". The rich evaluation matrix is preferred when the
// generator produced one; the flat criteria list is the older fallback.
export function buildReviewCriteria({
  brief,
  transcriptTurns,
}: {
  brief: CandidateBriefDto | null;
  transcriptTurns: ReplayTurn[];
}): ReviewCriterion[] {
  if (!brief) {
    return [];
  }

  const originMs = replayOriginMs(transcriptTurns);
  const turnById = new Map(transcriptTurns.map((turn) => [turn.turnId, turn]));
  const matrixCriteria = brief.evaluationMatrix?.criteria ?? [];

  if (matrixCriteria.length > 0) {
    return matrixCriteria.map((criterion) => ({
      askOnNextCall: [...criterion.followUps, ...criterion.missingInfo],
      id: criterion.criterionId,
      label: criterion.label,
      note: criterion.rationale,
      quote: criterion.evidence[0]?.text ?? null,
      startMs: evidenceStartMs(criterion.evidence[0], turnById, originMs),
      status: matrixStatus(criterion.status),
    }));
  }

  return brief.criteria.map((criterion) => ({
    askOnNextCall: [],
    id: criterion.criterionId,
    label: criterion.label,
    note: criterion.rationale,
    quote: criterion.evidence[0]?.text ?? null,
    startMs: evidenceStartMs(criterion.evidence[0], turnById, originMs),
    status: legacyStatus(criterion.status),
  }));
}

export function reviewCriterionTone(status: ReviewCriterionStatus) {
  if (status === "strong") {
    return {
      badgeClassName: "bg-meadow-50 text-meadow-800",
      dotClassName: "bg-olive-500",
      quoteBorderClassName: "border-olive-500",
      segmentClassName: "bg-olive-500",
    };
  }

  if (status === "partial") {
    return {
      badgeClassName: "bg-[#fbf0d8] text-[#6b4710]",
      dotClassName: "bg-[#cf9026]",
      quoteBorderClassName: "border-[#cf9026]",
      segmentClassName: "bg-signal-medium",
    };
  }

  return {
    badgeClassName: "bg-[#fbeae4] text-[#8a3a26]",
    dotClassName: "bg-[#c4683f]",
    quoteBorderClassName: "border-[#c4683f]",
    segmentClassName: "bg-signal-weak",
  };
}

function matrixStatus(
  status: "missing" | "partial" | "risk" | "satisfied" | "unclear",
): ReviewCriterionStatus {
  if (status === "satisfied") {
    return "strong";
  }

  if (status === "partial" || status === "unclear") {
    return "partial";
  }

  return "missing";
}

function legacyStatus(
  status: "Medium" | "Not assessable" | "Strong" | "Weak",
): ReviewCriterionStatus {
  if (status === "Strong") {
    return "strong";
  }

  return status === "Medium" ? "partial" : "missing";
}

function evidenceStartMs(
  evidence: { transcriptTurnId?: string } | undefined,
  turnById: Map<string, ReplayTurn>,
  originMs: number | null,
) {
  const turn = evidence?.transcriptTurnId
    ? turnById.get(evidence.transcriptTurnId)
    : undefined;

  return turn ? replayOffsetMs(turn.startedAt, originMs) : null;
}
