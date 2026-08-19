import {
  candidateBriefSchema,
  type CandidateBriefDto,
  type WorkspaceLanguage,
} from "@prelude/contracts";
import {
  complianceFlagCodes,
  defaultComplianceFlags,
  disallowedQuestionTopics,
} from "@prelude/core";
import { prisma, type Prisma } from "@prelude/db";
import { createNotificationDispatcher } from "@prelude/notifications";

import {
  candidateBriefCopy,
  type CandidateBriefCopy,
} from "./candidate-brief-copy";
import { createOpenAICandidateBriefSynthesizer } from "./candidate-brief-openai";
import {
  getCandidateSessionEvidence,
  type CandidateSessionEvidence,
  type CandidateTranscriptTurn,
} from "./live-session-evidence";
import {
  readWorkspaceLanguageValue,
  resolveWorkspaceLanguage,
} from "../organizations/content-language";

export const candidateBriefPromptVersion = "candidate-brief-v1";
export const candidateBriefSchemaVersion = 1;
export const defaultCandidateBriefLlmModel = "gpt-4.1-mini";
export const defaultCandidateBriefLlmTimeoutMs = 20_000;

const notificationDispatcher = createNotificationDispatcher();

export type CandidateBriefSynthesizerInput = {
  candidateLabel: string;
  candidateSessionId: string;
  criteria: BriefCriterion[];
  evidence: CandidateSessionEvidence;
  jobTitle: string;
  // Workspace language the recruiter-facing analysis is written in (plan
  // 2026-08-18, rule 1). An input fact resolved server-side, never a model
  // output: the brief is one shared artifact, so it cannot follow the reader.
  language: WorkspaceLanguage;
  roleTitle: string;
};

export type BriefCriterion = {
  description: string;
  id: string;
  label: string;
};

export type CandidateBriefSynthesizer = {
  modelName: string;
  provider: string;
  synthesize: (
    input: CandidateBriefSynthesizerInput,
  ) => Promise<CandidateBriefDto>;
};

export type GenerateCandidateBriefResult =
  | {
      brief: CandidateBriefDto;
      status: CandidateBriefDto["status"];
    }
  | {
      reason: "candidate_session_not_found" | "runtime_not_ready";
      status: "skipped";
    }
  | {
      error: string;
      status: "failed";
    };

export async function generateCandidateBriefForSession({
  candidateSessionId,
  organizationId,
  synthesizer = createCandidateBriefSynthesizerFromEnv(),
}: {
  candidateSessionId: string;
  organizationId: string;
  synthesizer?: CandidateBriefSynthesizer;
}): Promise<GenerateCandidateBriefResult> {
  const session = await prisma.candidateSession.findFirst({
    include: {
      candidateBrief: true,
      interview: true,
      job: true,
      organization: { select: { settings: true } },
    },
    where: {
      id: candidateSessionId,
      organizationId,
    },
  });

  if (!session) {
    return { reason: "candidate_session_not_found", status: "skipped" };
  }

  // Resolved here, on every run: a regeneration writes today's workspace
  // language, not whatever the previous attempt happened to be stamped with.
  const language = resolveWorkspaceLanguage(
    readWorkspaceLanguageValue(session.organization?.settings ?? null),
  );
  const criteria = readCriteria(session.interview.criteria);
  const evidence = await getCandidateSessionEvidence({
    productSession: session,
    questionCount: readQuestions(session.interview.questions).length,
  });

  await prisma.candidateBrief.upsert({
    create: {
      candidateSessionId: session.id,
      organizationId: session.organizationId,
      schemaVersion: candidateBriefSchemaVersion,
      status: "processing",
    },
    update: {
      failedReason: null,
      status: "processing",
    },
    where: { candidateSessionId: session.id },
  });

  try {
    const shouldUseConservativeLocalBrief =
      evidence.status !== "completed" ||
      evidence.transcriptTurns.filter((turn) => turn.speaker === "candidate")
        .length === 0;
    const brief = candidateBriefSchema.parse(
      shouldUseConservativeLocalBrief
        ? buildLocalCandidateBrief({
            candidateLabel:
              session.candidateName ??
              session.candidateEmail ??
              `Candidate ${session.id.slice(-6)}`,
            candidateSessionId: session.id,
            criteria,
            evidence,
            jobTitle: session.job.title,
            language,
            roleTitle: session.interview.roleTitle,
          })
        : await synthesizer.synthesize({
            candidateLabel:
              session.candidateName ??
              session.candidateEmail ??
              `Candidate ${session.id.slice(-6)}`,
            candidateSessionId: session.id,
            criteria,
            evidence,
            jobTitle: session.job.title,
            language,
            roleTitle: session.interview.roleTitle,
          }),
    );
    const evidenceRefs = brief.criteria.flatMap((criterion) =>
      criterion.evidence.map((item) => ({
        criterionId: criterion.criterionId,
        eventId: item.eventId ?? null,
        questionId: item.questionId ?? null,
        transcriptTurnId: item.transcriptTurnId ?? null,
      })),
    );

    await prisma.candidateBrief.update({
      data: {
        evidence: evidenceRefs,
        failedReason: null,
        generatedAt: new Date(),
        language,
        limitations: brief.limitations,
        modelName: synthesizer.modelName,
        modelProvider: synthesizer.provider,
        recommendation: brief.suggestedNextStep ?? "to_review",
        schemaVersion: candidateBriefSchemaVersion,
        status: brief.status,
        summaryJson: brief as unknown as Prisma.InputJsonValue,
      },
      where: { candidateSessionId: session.id },
    });

    if (brief.status === "completed") {
      await notifyCandidateBrief({
        candidateSessionId: session.id,
        status: "completed",
      });
    }

    return { brief, status: brief.status };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Candidate brief failed.";
    await prisma.candidateBrief.update({
      data: {
        failedReason: message,
        // `language` is deliberately untouched: the stamp describes the
        // summaryJson that survives this write. A first-ever failure never
        // stamped anything (the column is null from birth), and a failed
        // regeneration keeps the previous brief's content, so it keeps that
        // content's language too.
        modelName: synthesizer.modelName,
        modelProvider: synthesizer.provider,
        status: "failed",
      },
      where: { candidateSessionId: session.id },
    });
    await notifyCandidateBrief({
      candidateSessionId: session.id,
      status: "failed",
    });

    return { error: message, status: "failed" };
  }
}

async function notifyCandidateBrief({
  candidateSessionId,
  status,
}: {
  candidateSessionId: string;
  status: "completed" | "failed";
}) {
  try {
    await notificationDispatcher.notifyCandidateBrief({
      candidateSessionId,
      status,
    });
  } catch (error) {
    // Brief persistence remains the source of truth; a notification failure is
    // recorded when possible but must not turn a generated brief into a failure.
    console.error("[notifications] recruiter brief dispatch failed", error);
  }
}

export function createCandidateBriefSynthesizerFromEnv(
  source: Record<string, string | undefined> = process.env,
): CandidateBriefSynthesizer {
  const enabled = source.CANDIDATE_BRIEF_LLM_ENABLED;
  const apiKey = source.OPENAI_API_KEY;

  if (!isEnabled(enabled) || !apiKey) {
    return createLocalCandidateBriefSynthesizer();
  }

  const primary = createOpenAICandidateBriefSynthesizer({
    apiKey,
    model: source.CANDIDATE_BRIEF_LLM_MODEL ?? defaultCandidateBriefLlmModel,
    timeoutMs: toTimeoutMs(source.CANDIDATE_BRIEF_LLM_TIMEOUT_SECONDS),
  });

  return createFallbackCandidateBriefSynthesizer({
    fallback: createLocalCandidateBriefSynthesizer(),
    primary,
  });
}

export function createLocalCandidateBriefSynthesizer(): CandidateBriefSynthesizer {
  return {
    modelName: candidateBriefPromptVersion,
    provider: "local_synthesis",
    synthesize: async (input) => buildLocalCandidateBrief(input),
  };
}

export function createFallbackCandidateBriefSynthesizer({
  fallback,
  primary,
}: {
  fallback: CandidateBriefSynthesizer;
  primary: CandidateBriefSynthesizer;
}): CandidateBriefSynthesizer {
  return {
    modelName: primary.modelName,
    provider: `${primary.provider}_with_${fallback.provider}_fallback`,
    synthesize: async (input) => {
      try {
        return await primary.synthesize(input);
      } catch {
        const brief = await fallback.synthesize(input);
        return candidateBriefSchema.parse({
          ...brief,
          limitations: [
            ...brief.limitations,
            candidateBriefCopy(input.language).fallbackUsedLimitation,
          ].slice(0, 8),
        });
      }
    },
  };
}

export function buildLocalCandidateBrief(
  input: CandidateBriefSynthesizerInput,
): CandidateBriefDto {
  const copy = candidateBriefCopy(input.language);
  const candidateTurns = input.evidence.transcriptTurns.filter(
    (turn) => turn.speaker === "candidate",
  );
  const hasSensitiveSignal = candidateTurns.some((turn) =>
    containsSensitiveTopic(turn.text),
  );
  const reviewableCandidateTurns = candidateTurns
    .filter(isReviewableTurn)
    .filter((turn) => !containsSensitiveTopic(turn.text));
  const briefStatus = resolveLocalBriefStatus({
    evidence: input.evidence,
    reviewableCandidateTurns,
  });
  const limitations = getLimitations({
    candidateTurns,
    copy,
    evidence: input.evidence,
    hasSensitiveSignal,
  });
  const criteria = input.criteria.map((criterion) =>
    evaluateCriterion({
      copy,
      criterion,
      hasCandidateSpeech: candidateTurns.length > 0,
      reviewableCandidateTurns,
    }),
  );
  const strongOrMedium = criteria.filter(
    (criterion) =>
      criterion.status === "Strong" || criterion.status === "Medium",
  );
  const notAssessable = criteria.filter(
    (criterion) => criterion.status === "Not assessable",
  );
  const summary = buildSummary({
    candidateLabel: input.candidateLabel,
    candidateTurns,
    briefStatus,
    copy,
    evidenceStatus: input.evidence.status,
    roleTitle: input.roleTitle,
  });

  return candidateBriefSchema.parse({
    candidateSessionId: input.candidateSessionId,
    complianceFlags: [
      ...defaultComplianceFlags,
      ...(hasSensitiveSignal
        ? [complianceFlagCodes.sensitiveSignalReviewRequired]
        : []),
    ],
    criteria,
    limitations,
    pointsToClarify: [
      ...criteria
        .filter(
          (criterion) =>
            criterion.status === "Weak" ||
            criterion.status === "Not assessable",
        )
        .map((criterion) => copy.pointToClarify(criterion.label)),
      ...(input.evidence.questionCompletionRate !== null &&
      input.evidence.questionCompletionRate < 100
        ? [copy.missingQuestionsPoint]
        : []),
    ].slice(0, 8),
    risks:
      notAssessable.length > 0 ||
      criteria.some((criterion) => criterion.status === "Weak")
        ? [copy.notAssessableRisk]
        : [],
    evaluationMatrix: buildLocalEvaluationMatrix({
      copy,
      criteria,
      roleTitle: input.roleTitle,
    }),
    status: briefStatus,
    strengths: strongOrMedium
      .slice(0, 3)
      .map((criterion) => `${criterion.label}: ${criterion.rationale}`),
    suggestedNextStep: "to_review",
    summary,
  });
}

function evaluateCriterion({
  copy,
  criterion,
  hasCandidateSpeech,
  reviewableCandidateTurns,
}: {
  copy: CandidateBriefCopy;
  criterion: BriefCriterion;
  hasCandidateSpeech: boolean;
  reviewableCandidateTurns: CandidateTranscriptTurn[];
}): CandidateBriefDto["criteria"][number] {
  const evidence = reviewableCandidateTurns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(0, 2)
    .map((turn) => ({
      questionId: turn.questionId ?? undefined,
      text: truncateEvidenceText(turn.text),
      transcriptTurnId: turn.turnId,
    }));
  const combinedLength = evidence.reduce(
    (total, item) => total + item.text.length,
    0,
  );

  if (evidence.length === 0) {
    if (hasCandidateSpeech) {
      return {
        criterionId: criterion.id,
        evidence: [],
        label: criterion.label,
        rationale: copy.criterionRationale.noReviewableEvidence,
        status: "Weak",
      };
    }

    return {
      criterionId: criterion.id,
      evidence: [],
      label: criterion.label,
      rationale: copy.criterionRationale.notAssessable,
      status: "Not assessable",
    };
  }

  if (combinedLength >= 260) {
    return {
      criterionId: criterion.id,
      evidence,
      label: criterion.label,
      rationale: copy.criterionRationale.strong,
      status: "Strong",
    };
  }

  if (combinedLength >= 120) {
    return {
      criterionId: criterion.id,
      evidence,
      label: criterion.label,
      rationale: copy.criterionRationale.medium,
      status: "Medium",
    };
  }

  return {
    criterionId: criterion.id,
    evidence,
    label: criterion.label,
    rationale: copy.criterionRationale.weak,
    status: "Weak",
  };
}

function buildLocalEvaluationMatrix({
  copy,
  criteria,
  roleTitle,
}: {
  copy: CandidateBriefCopy;
  criteria: CandidateBriefDto["criteria"];
  roleTitle: string;
}): NonNullable<CandidateBriefDto["evaluationMatrix"]> {
  const matrixCriteria = criteria.map((criterion) => {
    const status = toMatrixStatus(criterion.status, criterion.evidence.length);
    const missingInfo =
      status === "satisfied" ? [] : [copy.matrixMissingInfo(criterion.label)];

    return {
      category: categorizeCriterion(criterion.label),
      confidence: toMatrixConfidence(criterion.status),
      criterionId: criterion.criterionId,
      evidence: criterion.evidence,
      followUps: status === "satisfied" ? [] : [copy.followUp(criterion.label)],
      label: criterion.label,
      missingInfo,
      rationale: criterion.rationale,
      status,
    };
  });
  const facts = criteria
    .flatMap((criterion) => criterion.evidence.slice(0, 1))
    // The quote itself stays exactly as the candidate said it (rule 4); only
    // the sentence introducing it follows the workspace language.
    .map((item) => copy.fact(truncateShortText(item.text)))
    .slice(0, 6);
  const inferredSignals = criteria
    .filter(
      (criterion) =>
        criterion.status === "Strong" || criterion.status === "Medium",
    )
    .slice(0, 6)
    .map((criterion) => ({
      confidence: toMatrixConfidence(criterion.status),
      evidence: criterion.evidence,
      label: copy.inferredSignalLabel(criterion.label),
    }));
  const weakOrMissing = matrixCriteria.filter(
    (criterion) => criterion.status !== "satisfied",
  );
  const recommendationLabel =
    matrixCriteria.length > 0 && weakOrMissing.length === 0
      ? "continue"
      : facts.length === 0
        ? "inconclusive"
        : "targeted_follow_up";

  return {
    criteria: matrixCriteria,
    facts,
    inferredSignals,
    missingInfo: dedupeStrings(
      matrixCriteria.flatMap((criterion) => criterion.missingInfo),
    ).slice(0, 8),
    recommendationConfidence:
      recommendationLabel === "continue"
        ? "medium"
        : facts.length === 0
          ? "low"
          : "medium",
    recommendationLabel,
    recommendationRationale:
      recommendationLabel === "continue"
        ? copy.recommendationRationale.continueReview(roleTitle)
        : facts.length === 0
          ? copy.recommendationRationale.inconclusive(roleTitle)
          : copy.recommendationRationale.targetedFollowUp(roleTitle),
    recommendedNextStep:
      recommendationLabel === "continue" ? "to_call" : "to_review",
    risks: criteria
      .filter((criterion) => criterion.status === "Weak")
      .map((criterion) => `${criterion.label}: ${criterion.rationale}`)
      .slice(0, 8),
  };
}

function toMatrixStatus(
  status: CandidateBriefDto["criteria"][number]["status"],
  evidenceCount: number,
): NonNullable<
  CandidateBriefDto["evaluationMatrix"]
>["criteria"][number]["status"] {
  switch (status) {
    case "Strong":
      return "satisfied";
    case "Medium":
      return "partial";
    case "Weak":
      return evidenceCount > 0 ? "unclear" : "risk";
    case "Not assessable":
      return "missing";
  }
}

function toMatrixConfidence(
  status: CandidateBriefDto["criteria"][number]["status"],
): NonNullable<
  CandidateBriefDto["evaluationMatrix"]
>["criteria"][number]["confidence"] {
  switch (status) {
    case "Strong":
      return "high";
    case "Medium":
      return "medium";
    case "Weak":
    case "Not assessable":
      return "low";
  }
}

function categorizeCriterion(
  label: string,
): NonNullable<
  CandidateBriefDto["evaluationMatrix"]
>["criteria"][number]["category"] {
  const normalized = normalizeText(label);

  if (containsAny(normalized, ["availability", "available", "mobility"])) {
    return "availability";
  }
  if (containsAny(normalized, ["logistics", "salary", "compensation"])) {
    return "logistics";
  }
  if (containsAny(normalized, ["motivation", "interest"])) {
    return "motivation";
  }
  if (containsAny(normalized, ["communication", "clarity"])) {
    return "communication";
  }
  if (containsAny(normalized, ["experience", "customer", "project"])) {
    return "experience";
  }

  return "role_specific";
}

function buildSummary({
  candidateLabel,
  candidateTurns,
  briefStatus,
  copy,
  evidenceStatus,
  roleTitle,
}: {
  briefStatus: CandidateBriefDto["status"];
  candidateLabel: string;
  candidateTurns: CandidateTranscriptTurn[];
  copy: CandidateBriefCopy;
  evidenceStatus: string;
  roleTitle: string;
}) {
  if (briefStatus === "technical_failure") {
    return copy.summary.technicalFailure({ candidateLabel, roleTitle });
  }

  if (briefStatus === "partial") {
    return copy.summary.partial({ candidateLabel, evidenceStatus, roleTitle });
  }

  if (briefStatus === "insufficient_signal") {
    return copy.summary.insufficientSignal({ candidateLabel, roleTitle });
  }

  if (candidateTurns.length === 0) {
    return copy.summary.noCandidateTurns({ candidateLabel, roleTitle });
  }

  return copy.summary.completed({
    candidateLabel,
    roleTitle,
    turnCount: candidateTurns.length,
  });
}

function truncateEvidenceText(text: string) {
  const normalized = text.trim();
  if (normalized.length <= 1200) {
    return normalized;
  }

  return `${normalized.slice(0, 1197).trimEnd()}...`;
}

function getLimitations({
  candidateTurns,
  copy,
  evidence,
  hasSensitiveSignal,
}: {
  candidateTurns: CandidateTranscriptTurn[];
  copy: CandidateBriefCopy;
  evidence: CandidateSessionEvidence;
  hasSensitiveSignal: boolean;
}) {
  const limitations: string[] = [
    copy.limitation.recruiterLimitation,
    copy.limitation.sensitiveHandling,
  ];

  if (candidateTurns.length === 0) {
    limitations.push(copy.limitation.noCandidateTurns);
  }

  if (evidence.status !== "completed") {
    limitations.push(copy.limitation.statusNotCompleted(evidence.status));
  }

  if (
    evidence.status === "failed" ||
    evidence.terminalEventType === "session_failed"
  ) {
    limitations.push(copy.limitation.technicalFailure);
  }

  if (
    evidence.questionCompletionRate !== null &&
    evidence.questionCompletionRate < 100
  ) {
    limitations.push(copy.limitation.incompleteQuestions);
  }

  if (hasSensitiveSignal) {
    limitations.push(copy.limitation.sensitiveExcluded);
  }

  return limitations;
}

function resolveLocalBriefStatus({
  evidence,
  reviewableCandidateTurns,
}: {
  evidence: CandidateSessionEvidence;
  reviewableCandidateTurns: CandidateTranscriptTurn[];
}): CandidateBriefDto["status"] {
  if (
    evidence.status === "failed" ||
    evidence.terminalEventType === "session_failed"
  ) {
    return "technical_failure";
  }

  if (reviewableCandidateTurns.length === 0) {
    return "insufficient_signal";
  }

  if (evidence.status !== "completed") {
    return "partial";
  }

  return "completed";
}

function isReviewableTurn(turn: CandidateTranscriptTurn) {
  const normalized = normalizeText(turn.text);
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length < 4) {
    return false;
  }

  if (containsAny(normalized, NON_REVIEWABLE_MARKERS)) {
    return false;
  }

  return true;
}

function containsSensitiveTopic(text: string) {
  const normalized = normalizeText(text);

  return SENSITIVE_TOPIC_MARKERS.some((marker) => {
    const normalizedMarker = normalizeText(marker);

    if (/\s/.test(normalizedMarker)) {
      return normalized.includes(normalizedMarker);
    }

    return new RegExp(`\\b${escapeRegExp(normalizedMarker)}\\b`).test(
      normalized,
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateShortText(text: string) {
  const normalized = text.trim();
  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157).trimEnd()}...`;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function containsAny(value: string, markers: readonly string[]) {
  return markers.some((marker) => value.includes(marker));
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function isEnabled(value: string | undefined) {
  return value === "1" || value === "true" || value === "yes";
}

function toTimeoutMs(value: string | undefined) {
  if (!value) {
    return defaultCandidateBriefLlmTimeoutMs;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return defaultCandidateBriefLlmTimeoutMs;
  }

  return Math.min(Math.round(seconds * 1000), 30000);
}

function readCriteria(value: unknown): BriefCriterion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCriterion).map((criterion) => ({
    description: criterion.description ?? criterion.prompt ?? "",
    id: criterion.id,
    label: criterion.label,
  }));
}

function readQuestions(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isCriterion(value: unknown): value is {
  description?: string;
  id: string;
  label: string;
  prompt?: string;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (typeof value.description === "string" || typeof value.prompt === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NON_REVIEWABLE_MARKERS = [
  "caca",
  "poop",
  "prout",
  "asdf",
  "football",
  "meteo",
  "weather",
  "je ne sais pas",
  "aucune idee",
  "no idea",
  "i don't know",
] as const;

const SENSITIVE_TOPIC_MARKERS = [
  ...disallowedQuestionTopics,
  "disabled",
  "disability",
  "ethnicity",
  "family",
  "gender",
  "health",
  "medical",
  "origin",
  "pregnant",
  "pregnancy",
  "children",
  "childcare",
  "married",
  "race",
  "nationality",
  "sexual orientation",
  "politics",
  "political",
  "religion",
  "religious",
  "face",
  "biometric",
] as const;
