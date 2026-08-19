import "server-only";

import {
  type CandidateBriefDto,
  interviewPlanCriterionSchema,
  interviewPlanQuestionSchema,
  type WorkspaceLanguage,
} from "@prelude/contracts";
import { prisma } from "@prelude/db";
import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
  InterviewQuestionCategory,
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
  toCandidateBriefView,
  type CriteriaDistribution,
} from "./candidate-review-signals";
import {
  expireStaleCandidateInvitations,
  toCandidateInvitationSummary,
  type CandidateInvitationSummary,
} from "./candidate-invitations";
import {
  formatReviewUserLabel,
  getReviewNotePreview,
} from "./candidate-review-display";
import { toScheduledCallSummary } from "./candidate-call-scheduling";
import { findCandidateSessionSpineForOrganization } from "./candidate-session-spine";
import { readOrganizationContentLanguages } from "../organizations/organization-content-languages";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type InterviewBuilderContext = {
  companyName: string;
  // What the builder's language selector starts on for a NEW draft (plan
  // 2026-08-18, rule 1). An existing draft uses its own stamp instead.
  defaultInterviewLanguage: WorkspaceLanguage;
  // The workspace language, for the recruiter-bound copy the builder writes
  // client-side (the rationale it rewrites when a question is removed). Kept
  // separate from `defaultInterviewLanguage` on purpose: one is candidate-bound
  // and per-draft, the other is recruiter-bound and per-workspace.
  workspaceLanguage: WorkspaceLanguage;
  initialDraft?: PersistedInterviewBuilderDraft;
  initialJob?: {
    description: string;
    id: string;
    location: string | null;
    title: string;
  };
};

export type PersistedInterviewBuilderDraft = {
  id: string;
  jobId: string;
  // Null on drafts generated before stamping existed; never backfilled, so the
  // builder resolves it against the workspace default on read.
  language: string | null;
  roleTitle: string;
  roleBrief: string;
  location: string | null;
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
        candidateInvitations: CandidateInvitationSummary[];
        candidateSessions: CandidateSessionSummary[];
        criteria: InterviewCriterionDraft[];
        draftId: string | null;
        estimatedMinutes: number | null;
        guardrails: string[];
        id: string;
        jobId: string;
        jobTitle: string;
        location: string | null;
        publicToken: string;
        questions: InterviewQuestionDraft[];
        responseModes: InterviewResponseMode[];
        roleBrief: string;
        roleTitle: string;
        sourceProvider: string | null;
        status: string;
        updatedAt: string;
      };
    }
  | {
      kind: "candidate_session";
      organizationName: string;
      // The language shared recruiter-bound analysis is generated in. Compared
      // against the brief's own stamp to decide whether a caveat badge is owed.
      workspaceLanguage: WorkspaceLanguage;
      candidateSession: CandidateSessionSummary & {
        brief: CandidateBriefDto | null;
        candidateEmail: string | null;
        evidence: CandidateSessionEvidence;
        interviewId: string;
        // The published interview's own stamp. Compared against the workspace
        // language to explain why verbatim quotes are not in the brief's
        // language; null means the role predates stamping.
        interviewLanguage: string | null;
        jobTitle: string;
        questions: InterviewQuestionDraft[];
        reviewNote: string | null;
        reviewNoteUpdatedAt: string | null;
        reviewNoteUpdatedBy: string | null;
        reviewStatusUpdatedAt: string | null;
        reviewStatusUpdatedBy: string | null;
        roleTitle: string;
        scheduledCall: ReturnType<typeof toScheduledCallSummary> | null;
      };
    };

export type CandidateSessionSummary = {
  analysisStatus: LiveAnalysisStatus;
  // The billing trace (amendment 18) — null together unless a `completed`
  // settlement ran with `CREDIT_BILLING_ENABLED` on. `billedOutcome` is
  // "captured" | "released" | null; kept as `string | null` here to mirror
  // the nullable Prisma column without importing a domain type into a loader.
  billedAnsweredCount: number | null;
  billedOutcome: string | null;
  billedRequiredCount: number | null;
  // The two brief facts that live on the ROW rather than inside `summaryJson`
  // (see `toCandidateBriefView`). `briefLanguage` is the stamp — null means
  // "generated before stamping existed" — and `briefRegenerationFailed` marks a
  // regeneration that failed OVER a previous success, which the JSON-embedded
  // status cannot express because it still describes the surviving content.
  briefLanguage: string | null;
  briefRegenerationFailed: boolean;
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
  reviewNotePreview: string | null;
  reviewNoteUpdatedAt: string | null;
  reviewStatus: RecruiterReviewStatus;
  reviewStatusUpdatedAt: string | null;
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
    select: { name: true, settings: true },
    where: { id: scope.organizationId },
  });
  const { interviewDefault: defaultInterviewLanguage, workspace: workspaceLanguage } =
    readOrganizationContentLanguages(organization.settings);

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
        defaultInterviewLanguage,
        workspaceLanguage,
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
          language: draft.language,
          location: draft.job.location,
          responseModes: readResponseModes(draft.responseModes),
          roleBrief: draft.roleBrief,
          roleTitle: draft.roleTitle,
          seniority: readSeniority(draft.seniority),
          sourceAttachmentName: draft.sourceAttachmentName ?? undefined,
        },
      };
    }
  }

  const job = jobId
    ? await prisma.job.findFirst({
        where: {
          id: jobId,
          organizationId: scope.organizationId,
        },
      })
    : null;

  return {
    companyName: organization.name,
    defaultInterviewLanguage,
    workspaceLanguage,
    initialJob: job
      ? {
          description: job.description,
          id: job.id,
          location: job.location,
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
    // `settings` carries the workspace language the recruiter brief is written
    // in — the review page needs it to tell an honest brief from a stale one.
    select: { name: true, settings: true },
    where: { id: scope.organizationId },
  });

  await expireStaleCandidateInvitations({
    interviewId: idOrSessionId,
    organizationId: scope.organizationId,
  });

  const interview = await prisma.interview.findFirst({
    include: {
      candidateInvitations: {
        include: {
          candidateSessions: {
            orderBy: { updatedAt: "desc" },
            select: {
              id: true,
              realtimeSessionId: true,
              status: true,
            },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      },
      candidateSessions: {
        include: {
          candidateBrief: true,
          job: true,
          reviewNoteUpdatedBy: {
            select: {
              email: true,
              name: true,
            },
          },
          reviewStatusUpdatedBy: {
            select: {
              email: true,
              name: true,
            },
          },
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
        candidatePath: candidatePathForInterview(interview),
        candidateInvitations: interview.candidateInvitations.map((invitation) =>
          toCandidateInvitationSummary(invitation),
        ),
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
        jobId: interview.jobId,
        jobTitle: interview.job.title,
        location: interview.job.location,
        publicToken: interview.publicToken,
        questions: readQuestions(interview.questions),
        responseModes: readResponseModes(interview.responseModes),
        roleBrief: interview.roleBrief,
        roleTitle: interview.roleTitle,
        sourceProvider: interview.job.sourceProvider,
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
        candidateEmail:
          candidateSession.candidateEmail ??
          candidateSession.candidateInvitation?.candidateEmail ??
          null,
        eventCount: evidence.eventCount,
        evidence,
        interviewId: candidateSession.interviewId,
        interviewLanguage: candidateSession.interview.language,
        jobTitle: candidateSession.job.title,
        questions: readQuestions(candidateSession.interview.questions),
        questionCompletionRate: evidence.questionCompletionRate,
        reviewNote: candidateSession.reviewNote,
        reviewNoteUpdatedAt:
          candidateSession.reviewNoteUpdatedAt?.toISOString() ?? null,
        reviewNoteUpdatedBy: formatReviewUserLabel(
          candidateSession.reviewNoteUpdatedBy,
        ),
        reviewStatusUpdatedAt:
          candidateSession.reviewStatusUpdatedAt?.toISOString() ?? null,
        reviewStatusUpdatedBy: formatReviewUserLabel(
          candidateSession.reviewStatusUpdatedBy,
        ),
        roleTitle: candidateSession.interview.roleTitle,
        scheduledCall: candidateSession.scheduledCalls[0]
          ? toScheduledCallSummary(candidateSession.scheduledCalls[0])
          : null,
        status: evidence.status,
        transcriptTurnCount: evidence.transcriptTurns.length,
      },
      kind: "candidate_session",
      organizationName: organization.name,
      // Resolved server-side: the badge decision is "does this brief disagree
      // with what the workspace reads", never "what locale is this recruiter's
      // UI in" (plan 2026-08-18, rule 2 — the workspace language governs shared
      // artifacts, the user's own locale governs the interface).
      workspaceLanguage: readOrganizationContentLanguages(organization.settings)
        .workspace,
    };
  }

  return null;
}

export function candidatePathForInterview(interview: {
  candidateInvitations?: Array<{
    candidateEmail: string | null;
    candidateName: string | null;
    expiresAt: Date;
    status: string;
    token: string;
  }>;
  publicToken: string;
}) {
  const now = new Date();
  // Only a still-usable invitation may back the shareable link. A completed,
  // expired or superseded token is refused by the candidate app, so falling
  // back to one would hand the recruiter a dead link; the interview's public
  // token always opens a fresh attempt.
  const isOpen = (candidateInvitation: {
    expiresAt: Date;
    status: string;
  }) =>
    candidateInvitation.expiresAt > now &&
    !["completed", "expired", "superseded"].includes(
      candidateInvitation.status,
    );
  const invitation =
    interview.candidateInvitations?.find(
      (candidateInvitation) =>
        !candidateInvitation.candidateEmail &&
        !candidateInvitation.candidateName &&
        isOpen(candidateInvitation),
    ) ?? interview.candidateInvitations?.find(isOpen);

  return `/interview/${invitation?.token ?? interview.publicToken}`;
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
    billedAnsweredCount: number | null;
    billedOutcome: string | null;
    billedRequiredCount: number | null;
    candidateBrief?: {
      candidateSessionId: string;
      language?: string | null;
      limitations: unknown;
      status: string;
      summaryJson: unknown;
    } | null;
    candidateEmail: string | null;
    candidateName: string | null;
    completedAt: Date | null;
    id: string;
    realtimeSessionId: string | null;
    reviewNote?: string | null;
    reviewNoteUpdatedAt?: Date | null;
    reviewStatus?: string | null;
    reviewStatusUpdatedAt?: Date | null;
    startedAt: Date | null;
    status: string;
    updatedAt: Date;
  };
}): CandidateSessionSummary {
  const briefView = toCandidateBriefView(session.candidateBrief ?? null);
  const reviewSignals = getCandidateReviewSignals(briefView.content);
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
    billedAnsweredCount: session.billedAnsweredCount,
    billedOutcome: session.billedOutcome,
    billedRequiredCount: session.billedRequiredCount,
    briefLanguage: briefView.language,
    briefRegenerationFailed: briefView.regenerationFailed,
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
    reviewNotePreview: getReviewNotePreview(session.reviewNote),
    reviewNoteUpdatedAt: session.reviewNoteUpdatedAt?.toISOString() ?? null,
    reviewStatus: resolveReviewStatus(session.reviewStatus),
    reviewStatusUpdatedAt: session.reviewStatusUpdatedAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    status,
    transcriptTurnCount: eventStats?.transcriptTurnCount ?? 0,
  };
}

function readQuestions(value: unknown): InterviewQuestionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(upgradeStoredQuestion)
    .filter((question): question is InterviewQuestionDraft =>
      Boolean(question),
    );
}

function upgradeStoredQuestion(value: unknown): InterviewQuestionDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  // Coerce legacy rows (signal -> expectedSignal, missing Hybrid fields)
  // through the canonical question contract.
  const parsed = interviewPlanQuestionSchema.safeParse({
    id: value.id,
    prompt: value.prompt,
    expectedSignal:
      typeof value.expectedSignal === "string"
        ? value.expectedSignal
        : typeof value.signal === "string"
          ? value.signal
          : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    required: typeof value.required === "boolean" ? value.required : undefined,
    maxFollowups:
      typeof value.maxFollowups === "number" ? value.maxFollowups : undefined,
    durationSeconds:
      typeof value.durationSeconds === "number"
        ? value.durationSeconds
        : undefined,
    source: typeof value.source === "string" ? value.source : undefined,
  });

  if (!parsed.success) {
    return null;
  }

  return {
    category: parsed.data.category as InterviewQuestionCategory,
    durationSeconds: parsed.data.durationSeconds,
    expectedSignal:
      parsed.data.expectedSignal ?? "Job-related screening signal",
    id: parsed.data.id,
    maxFollowups: parsed.data.maxFollowups,
    prompt: parsed.data.prompt,
    required: parsed.data.required,
    source: parsed.data.source,
  };
}

function readCriteria(value: unknown): InterviewCriterionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((criterion) => {
      const parsed = interviewPlanCriterionSchema.safeParse(criterion);
      return parsed.success ? parsed.data : null;
    })
    .filter((criterion): criterion is InterviewCriterionDraft =>
      Boolean(criterion),
    );
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
  // "video" was dropped as a selectable mode. It is intentionally absent from
  // the allowlist so a legacy persisted row carrying it loads cleanly with the
  // video entry filtered out rather than surfacing an unsupported mode.
  const modes = new Set<InterviewResponseMode>(["audio", "text"]);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
