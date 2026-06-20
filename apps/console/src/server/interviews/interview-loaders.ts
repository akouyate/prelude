import "server-only";

import { type CandidateBriefDto } from "@prelude/contracts";
import { prisma } from "@prelude/db";
import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";

import type { InterviewResponseMode } from "./interview-drafts";
import {
  getLiveEventStatsBySessionId,
  getLiveStatusById,
  getQuestionCompletionRate,
  resolveAnalysisStatus,
  resolveReviewStatus,
  type LiveAnalysisStatus,
  type LiveEventStats,
  type RecruiterReviewStatus,
} from "./live-session-insights";
import {
  getCandidateSessionEvidence,
  type CandidateSessionEvidence,
} from "./live-session-evidence";
import {
  getCandidateReviewSignals,
  toCandidateBriefDto,
  type CriteriaDistribution,
} from "./candidate-review-signals";
import { findCandidateSessionSpineForOrganization } from "./candidate-session-spine";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type InterviewBuilderContext = {
  companyName: string;
  initialDraft?: PersistedInterviewBuilderDraft;
  initialJob?: {
    description: string;
    id: string;
    title: string;
  };
};

export type PersistedInterviewBuilderDraft = {
  id: string;
  jobId: string;
  roleTitle: string;
  roleBrief: string;
  seniority: InterviewSeniority;
  focus: InterviewFocus[];
  responseModes: InterviewResponseMode[];
  sourceAttachmentName?: string;
  draft: InterviewAgentDraft;
};

export type InterviewDetailData =
  | {
      kind: "interview";
      organizationName: string;
      interview: {
        candidatePath: string;
        candidateSessions: CandidateSessionSummary[];
        criteria: InterviewCriterionDraft[];
        draftId: string | null;
        estimatedMinutes: number | null;
        guardrails: string[];
        id: string;
        jobTitle: string;
        publicToken: string;
        questions: InterviewQuestionDraft[];
        responseModes: InterviewResponseMode[];
        roleBrief: string;
        roleTitle: string;
        status: string;
        updatedAt: string;
      };
    }
  | {
      kind: "candidate_session";
      organizationName: string;
      candidateSession: CandidateSessionSummary & {
        brief: CandidateBriefDto | null;
        evidence: CandidateSessionEvidence;
        interviewId: string;
        jobTitle: string;
        questions: InterviewQuestionDraft[];
        roleTitle: string;
      };
    };

export type CandidateSessionSummary = {
  analysisStatus: LiveAnalysisStatus;
  candidateLabel: string;
  completedAt: string | null;
  eventCount: number;
  criteriaDistribution: CriteriaDistribution;
  hasCompletedBrief: boolean;
  id: string;
  limitationsCount: number;
  pointsToClarifyCount: number | null;
  questionCompletionRate: number | null;
  realtimeSessionId: string | null;
  reviewStatus: RecruiterReviewStatus;
  startedAt: string | null;
  status: string;
  transcriptTurnCount: number;
};

export async function getInterviewBuilderContext({
  draftId,
  jobId,
}: {
  draftId?: string;
  jobId?: string;
}): Promise<InterviewBuilderContext> {
  const scope = await getCompletedOrganizationScope();

  const organization = await prisma.organization.findUniqueOrThrow({
    select: { name: true },
    where: { id: scope.organizationId },
  });

  if (draftId) {
    const draft = await prisma.interviewDraft.findFirst({
      include: { job: true },
      where: {
        id: draftId,
        organizationId: scope.organizationId,
      },
    });

    if (draft) {
      return {
        companyName: organization.name,
        initialDraft: {
          draft: {
            criteria: readCriteria(draft.criteria),
            estimatedMinutes: draft.estimatedMinutes ?? 4,
            guardrails: readStringArray(draft.guardrails),
            questions: readQuestions(draft.questions),
            rationale: draft.rationale ?? "",
          },
          focus: readFocus(draft.focus),
          id: draft.id,
          jobId: draft.jobId,
          responseModes: readResponseModes(draft.responseModes),
          roleBrief: draft.roleBrief,
          roleTitle: draft.roleTitle,
          seniority: readSeniority(draft.seniority),
          sourceAttachmentName: draft.sourceAttachmentName ?? undefined,
        },
      };
    }
  }

  const job = await prisma.job.findFirst({
    orderBy: { createdAt: "desc" },
    where: {
      organizationId: scope.organizationId,
      ...(jobId ? { id: jobId } : {}),
    },
  });

  return {
    companyName: organization.name,
    initialJob: job
      ? {
          description: job.description,
          id: job.id,
          title: job.title,
        }
      : undefined,
  };
}

export async function getInterviewDetail(
  idOrSessionId: string,
): Promise<InterviewDetailData | null> {
  const scope = await getCompletedOrganizationScope();
  const organization = await prisma.organization.findUniqueOrThrow({
    select: { name: true },
    where: { id: scope.organizationId },
  });

  const interview = await prisma.interview.findFirst({
    include: {
      candidateSessions: {
        include: {
          candidateBrief: true,
          job: true,
        },
        orderBy: { updatedAt: "desc" },
      },
      job: true,
    },
    where: {
      id: idOrSessionId,
      organizationId: scope.organizationId,
    },
  });

  if (interview) {
    const realtimeSessionIds = interview.candidateSessions
      .map((session) => session.realtimeSessionId)
      .filter((id): id is string => Boolean(id));
    const [liveStatusById, eventStatsBySessionId] = await Promise.all([
      getLiveStatusById(realtimeSessionIds),
      getLiveEventStatsBySessionId(realtimeSessionIds),
    ]);
    const questionCount = readQuestions(interview.questions).length;

    return {
      interview: {
        candidatePath: `/interview/${interview.publicToken}`,
        candidateSessions: interview.candidateSessions.map((session) =>
          toCandidateSessionSummary({
            eventStatsBySessionId,
            liveStatusById,
            questionCount,
            session,
          }),
        ),
        criteria: readCriteria(interview.criteria),
        draftId: interview.draftId,
        estimatedMinutes: interview.estimatedMinutes,
        guardrails: readStringArray(interview.guardrails),
        id: interview.id,
        jobTitle: interview.job.title,
        publicToken: interview.publicToken,
        questions: readQuestions(interview.questions),
        responseModes: readResponseModes(interview.responseModes),
        roleBrief: interview.roleBrief,
        roleTitle: interview.roleTitle,
        status: interview.status,
        updatedAt: interview.updatedAt.toISOString(),
      },
      kind: "interview",
      organizationName: organization.name,
    };
  }

  const candidateSession = await findCandidateSessionSpineForOrganization({
    idOrRealtimeSessionId: idOrSessionId,
    organizationId: scope.organizationId,
  });

  if (candidateSession) {
    const realtimeSessionIds = candidateSession.realtimeSessionId
      ? [candidateSession.realtimeSessionId]
      : [];
    const [liveStatusById, eventStatsBySessionId] = await Promise.all([
      getLiveStatusById(realtimeSessionIds),
      getLiveEventStatsBySessionId(realtimeSessionIds),
    ]);
    const questionCount = readQuestions(
      candidateSession.interview.questions,
    ).length;
    const evidence = await getCandidateSessionEvidence({
      productSession: candidateSession,
      questionCount,
    });
    const summary = toCandidateSessionSummary({
      eventStatsBySessionId,
      liveStatusById,
      questionCount,
      session: candidateSession,
    });

    return {
      candidateSession: {
        ...summary,
        analysisStatus: resolveAnalysisStatus(
          evidence.status,
          {
            answerEvaluationCount:
              eventStatsBySessionId.get(
                candidateSession.realtimeSessionId ?? "",
              )?.answerEvaluationCount ?? 0,
            eventCount: evidence.eventCount,
            questionCompletedCount: Math.round(
              ((evidence.questionCompletionRate ?? 0) / 100) * questionCount,
            ),
            transcriptTurnCount: evidence.transcriptTurns.length,
          },
          candidateSession.candidateBrief?.status,
        ),
        completedAt: evidence.completedAt ?? summary.completedAt,
        brief: toCandidateBriefDto(candidateSession.candidateBrief),
        eventCount: evidence.eventCount,
        evidence,
        interviewId: candidateSession.interviewId,
        jobTitle: candidateSession.job.title,
        questions: readQuestions(candidateSession.interview.questions),
        questionCompletionRate: evidence.questionCompletionRate,
        roleTitle: candidateSession.interview.roleTitle,
        status: evidence.status,
        transcriptTurnCount: evidence.transcriptTurns.length,
      },
      kind: "candidate_session",
      organizationName: organization.name,
    };
  }

  return null;
}

function toCandidateSessionSummary({
  eventStatsBySessionId,
  liveStatusById,
  questionCount,
  session,
}: {
  eventStatsBySessionId: Map<string, LiveEventStats>;
  liveStatusById: Map<string, string>;
  questionCount: number;
  session: {
    candidateBrief?: {
      candidateSessionId: string;
      limitations: unknown;
      status: string;
      summaryJson: unknown;
    } | null;
    candidateEmail: string | null;
    candidateName: string | null;
    completedAt: Date | null;
    id: string;
    realtimeSessionId: string | null;
    reviewStatus?: string | null;
    startedAt: Date | null;
    status: string;
    updatedAt: Date;
  };
}): CandidateSessionSummary {
  const brief = toCandidateBriefDto(session.candidateBrief ?? null);
  const reviewSignals = getCandidateReviewSignals(brief);
  const status =
    (session.realtimeSessionId
      ? liveStatusById.get(session.realtimeSessionId)
      : undefined) ?? session.status;
  const eventStats = session.realtimeSessionId
    ? eventStatsBySessionId.get(session.realtimeSessionId)
    : undefined;

  return {
    analysisStatus: resolveAnalysisStatus(
      status,
      eventStats,
      session.candidateBrief?.status,
    ),
    candidateLabel:
      session.candidateName ??
      session.candidateEmail ??
      `Candidate ${session.id.slice(-6)}`,
    completedAt:
      session.completedAt?.toISOString() ??
      (status === "completed" ? session.updatedAt.toISOString() : null),
    criteriaDistribution: reviewSignals.criteriaDistribution,
    eventCount: eventStats?.eventCount ?? 0,
    hasCompletedBrief: reviewSignals.hasCompletedBrief,
    id: session.id,
    limitationsCount: reviewSignals.limitationsCount,
    pointsToClarifyCount: reviewSignals.pointsToClarifyCount,
    questionCompletionRate: getQuestionCompletionRate({
      questionCount,
      stats: eventStats,
    }),
    realtimeSessionId: session.realtimeSessionId,
    reviewStatus: resolveReviewStatus(session.reviewStatus),
    startedAt: session.startedAt?.toISOString() ?? null,
    status,
    transcriptTurnCount: eventStats?.transcriptTurnCount ?? 0,
  };
}

function readQuestions(value: unknown): InterviewQuestionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isQuestionDraft);
}

function readCriteria(value: unknown): InterviewCriterionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCriterionDraft);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readFocus(value: unknown): InterviewFocus[] {
  const focus = new Set<InterviewFocus>([
    "communication",
    "motivation",
    "role_skills",
    "situational_judgment",
  ]);

  return readStringArray(value).filter((item): item is InterviewFocus =>
    focus.has(item as InterviewFocus),
  );
}

function readResponseModes(value: unknown): InterviewResponseMode[] {
  const modes = new Set<InterviewResponseMode>(["audio", "text", "video"]);
  const selected = readStringArray(value).filter(
    (item): item is InterviewResponseMode =>
      modes.has(item as InterviewResponseMode),
  );

  return selected.length > 0 ? selected : ["text", "audio"];
}

function readSeniority(value: string | null): InterviewSeniority {
  if (value === "junior" || value === "mid" || value === "senior") {
    return value;
  }

  return "mid";
}

function isQuestionDraft(value: unknown): value is InterviewQuestionDraft {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.prompt === "string" &&
    typeof value.signal === "string" &&
    typeof value.durationSeconds === "number" &&
    (value.source === "agent" ||
      value.source === "attachment" ||
      value.source === "job_description")
  );
}

function isCriterionDraft(value: unknown): value is InterviewCriterionDraft {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.description === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
