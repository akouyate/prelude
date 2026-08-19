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

// Case-folds a language tag for comparison only. Deliberately NOT the catalogue
// validator: both functions below must keep surfacing out-of-catalogue tags
// ("de", "en-US") rather than folding them into "unknown".
const foldLanguage = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

export type BriefLanguageBadge =
  | { kind: "other"; language: string }
  | { kind: "unknown" };

/**
 * When the brief's language deserves a visible caveat (plan 2026-08-18, rule 6).
 *
 * A brief is one shared artifact read by the whole team, so it is generated in
 * the WORKSPACE language — the badge only appears when what the recruiter is
 * about to read is not that language:
 * - stamped and equal   -> null, no badge (the overwhelming majority)
 * - stamped and different -> "other", naming the language it was written in
 * - unstamped           -> "unknown", i.e. generated before stamping existed
 *
 * An out-of-catalogue stamp stays visible as `other` rather than being folded
 * into "unknown": the honest statement is "not your language", not "no idea".
 */
export function resolveBriefLanguageBadge({
  briefLanguage,
  workspaceLanguage,
}: {
  briefLanguage: string | null;
  workspaceLanguage: string;
}): BriefLanguageBadge | null {
  const stamped = foldLanguage(briefLanguage);
  if (!stamped) {
    return { kind: "unknown" };
  }

  return stamped === foldLanguage(workspaceLanguage)
    ? null
    : { kind: "other", language: stamped };
}

export type QuoteLanguageNote = { language: string };

/**
 * Whether the recruiter needs telling why the evidence quotes are not in the
 * language the brief is written in (plan 2026-08-18, rules 1 + 4).
 *
 * A workspace screens candidates in whatever language each ROLE is published
 * in, while the shared brief always follows the WORKSPACE language. When those
 * two differ — a French workspace interviewing in English — the analysis is
 * French and the blockquotes under it are verbatim English, because a candidate
 * quote is audit evidence tied to a transcript turn and is never translated.
 * Unexplained, that reads as a translation bug, or gets charged to the candidate
 * as a communication weakness.
 *
 * Deliberately keyed off the INTERVIEW language, not `brief.language`: this is a
 * statement about what the candidate actually said. An unstamped interview
 * yields null — there is no honest claim to make about a language nobody
 * recorded.
 */
export function resolveQuoteLanguageNote({
  interviewLanguage,
  workspaceLanguage,
}: {
  interviewLanguage: string | null;
  workspaceLanguage: string;
}): QuoteLanguageNote | null {
  const spoken = foldLanguage(interviewLanguage);
  if (!spoken || spoken === foldLanguage(workspaceLanguage)) {
    return null;
  }

  return { language: spoken };
}
