import {
  candidateBriefSchema,
  type CandidateBriefDto,
} from "@prelude/contracts";
import { defaultComplianceFlags, recruiterLimitationCopy } from "@prelude/core";
import { prisma, type Prisma } from "@prelude/db";

import {
  getCandidateSessionEvidence,
  type CandidateSessionEvidence,
  type CandidateTranscriptTurn,
} from "./live-session-evidence";

export const candidateBriefPromptVersion = "candidate-brief-v1";
export const candidateBriefSchemaVersion = 1;

export type CandidateBriefSynthesizerInput = {
  candidateLabel: string;
  candidateSessionId: string;
  criteria: BriefCriterion[];
  evidence: CandidateSessionEvidence;
  jobTitle: string;
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
      status: "completed";
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
  synthesizer = createLocalCandidateBriefSynthesizer(),
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
    },
    where: {
      id: candidateSessionId,
      organizationId,
    },
  });

  if (!session) {
    return { reason: "candidate_session_not_found", status: "skipped" };
  }

  const criteria = readCriteria(session.interview.criteria);
  const evidence = await getCandidateSessionEvidence({
    productSession: session,
    questionCount: readQuestions(session.interview.questions).length,
  });

  if (evidence.status !== "completed") {
    await prisma.candidateBrief.upsert({
      create: {
        candidateSessionId: session.id,
        failedReason: "Runtime evidence is not complete yet.",
        organizationId: session.organizationId,
        schemaVersion: candidateBriefSchemaVersion,
        status: "pending",
      },
      update: {
        failedReason: "Runtime evidence is not complete yet.",
        status: "pending",
      },
      where: { candidateSessionId: session.id },
    });

    return { reason: "runtime_not_ready", status: "skipped" };
  }

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
    const brief = candidateBriefSchema.parse(
      await synthesizer.synthesize({
        candidateLabel:
          session.candidateName ??
          session.candidateEmail ??
          `Candidate ${session.id.slice(-6)}`,
        candidateSessionId: session.id,
        criteria,
        evidence,
        jobTitle: session.job.title,
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
        limitations: brief.limitations,
        modelName: synthesizer.modelName,
        modelProvider: synthesizer.provider,
        recommendation: brief.suggestedNextStep ?? "to_review",
        schemaVersion: candidateBriefSchemaVersion,
        status: "completed",
        summaryJson: brief as unknown as Prisma.InputJsonValue,
      },
      where: { candidateSessionId: session.id },
    });

    return { brief, status: "completed" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Candidate brief failed.";
    await prisma.candidateBrief.update({
      data: {
        failedReason: message,
        modelName: synthesizer.modelName,
        modelProvider: synthesizer.provider,
        status: "failed",
      },
      where: { candidateSessionId: session.id },
    });

    return { error: message, status: "failed" };
  }
}

export function createLocalCandidateBriefSynthesizer(): CandidateBriefSynthesizer {
  return {
    modelName: candidateBriefPromptVersion,
    provider: "local_synthesis",
    synthesize: async (input) => buildLocalCandidateBrief(input),
  };
}

export function buildLocalCandidateBrief(
  input: CandidateBriefSynthesizerInput,
): CandidateBriefDto {
  const candidateTurns = input.evidence.transcriptTurns.filter(
    (turn) => turn.speaker === "candidate",
  );
  const limitations = getLimitations(input.evidence, candidateTurns);
  const criteria = input.criteria.map((criterion) =>
    evaluateCriterion(criterion, candidateTurns),
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
    roleTitle: input.roleTitle,
  });

  return candidateBriefSchema.parse({
    candidateSessionId: input.candidateSessionId,
    complianceFlags: [...defaultComplianceFlags],
    criteria,
    limitations,
    pointsToClarify: [
      ...criteria
        .filter(
          (criterion) =>
            criterion.status === "Weak" ||
            criterion.status === "Not assessable",
        )
        .map((criterion) => `Clarify ${criterion.label.toLowerCase()}.`),
      ...(input.evidence.questionCompletionRate !== null &&
      input.evidence.questionCompletionRate < 100
        ? ["Confirm the missing interview questions before making a decision."]
        : []),
    ].slice(0, 8),
    risks:
      notAssessable.length > 0
        ? ["Some criteria are not assessable from the available transcript."]
        : [],
    status: "completed",
    strengths: strongOrMedium
      .slice(0, 3)
      .map((criterion) => `${criterion.label}: ${criterion.rationale}`),
    suggestedNextStep: "to_review",
    summary,
  });
}

function evaluateCriterion(
  criterion: BriefCriterion,
  candidateTurns: CandidateTranscriptTurn[],
): CandidateBriefDto["criteria"][number] {
  const evidence = candidateTurns
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
    return {
      criterionId: criterion.id,
      evidence: [],
      label: criterion.label,
      rationale: "Not assessable from the available transcript evidence.",
      status: "Not assessable",
    };
  }

  if (combinedLength >= 260) {
    return {
      criterionId: criterion.id,
      evidence,
      label: criterion.label,
      rationale: "Transcript includes concrete, reviewable evidence.",
      status: "Strong",
    };
  }

  if (combinedLength >= 120) {
    return {
      criterionId: criterion.id,
      evidence,
      label: criterion.label,
      rationale: "Transcript includes relevant but limited evidence.",
      status: "Medium",
    };
  }

  return {
    criterionId: criterion.id,
    evidence,
    label: criterion.label,
    rationale: "Transcript evidence is brief and needs recruiter follow-up.",
    status: "Weak",
  };
}

function buildSummary({
  candidateLabel,
  candidateTurns,
  roleTitle,
}: {
  candidateLabel: string;
  candidateTurns: CandidateTranscriptTurn[];
  roleTitle: string;
}) {
  if (candidateTurns.length === 0) {
    return `${candidateLabel} completed the ${roleTitle} screen, but the transcript does not contain enough candidate evidence for a substantive brief.`;
  }

  return `${candidateLabel} completed the ${roleTitle} screen with ${candidateTurns.length} candidate transcript turn${candidateTurns.length > 1 ? "s" : ""}. Review the cited evidence before deciding the next step.`;
}

function truncateEvidenceText(text: string) {
  const normalized = text.trim();
  if (normalized.length <= 1200) {
    return normalized;
  }

  return `${normalized.slice(0, 1197).trimEnd()}...`;
}

function getLimitations(
  evidence: CandidateSessionEvidence,
  candidateTurns: CandidateTranscriptTurn[],
) {
  const limitations: string[] = [recruiterLimitationCopy];

  if (candidateTurns.length === 0) {
    limitations.push("No candidate transcript turns were available.");
  }

  if (
    evidence.questionCompletionRate !== null &&
    evidence.questionCompletionRate < 100
  ) {
    limitations.push("The interview did not complete every planned question.");
  }

  return limitations;
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
