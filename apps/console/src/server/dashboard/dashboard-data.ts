import "server-only";

import { prisma } from "@prelude/db";

import {
  getLiveEventStatsBySessionId,
  getLiveStatusById,
  getQuestionCompletionRate,
  resolveAnalysisStatus,
  resolveReviewStatus,
  type LiveAnalysisStatus,
  type RecruiterReviewStatus,
} from "../interviews/live-session-insights";
import {
  getCandidateReviewSignals,
  toCandidateBriefDto,
  type CriteriaDistribution,
} from "../interviews/candidate-review-signals";
import { getReviewNotePreview } from "../interviews/candidate-review-display";
import { listCandidateSessionSpinesForOrganization } from "../interviews/candidate-session-spine";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type DashboardRoleScreenState =
  | "draft"
  | "paused"
  | "published"
  | "candidate_started"
  | "completed"
  | "needs_review";

export type ConsoleDashboardData = {
  organization: {
    id: string;
    companySize: string | null;
    defaultInterviewMode: string | null;
    hiringFocus: string | null;
    name: string;
  };
  metrics: {
    activeRoles: number;
    candidateStarted: number;
    completed: number;
    drafts: number;
    needsReview: number;
    published: number;
  };
  roles: Array<{
    candidateCount: number;
    candidatePath: string | null;
    description: string;
    href: string;
    id: string;
    jobId: string;
    location: string | null;
    sourceProvider: string | null;
    state: DashboardRoleScreenState;
    title: string;
    updatedAt: string;
  }>;
  reviewQueue: Array<{
    analysisStatus: LiveAnalysisStatus;
    candidateLabel: string;
    completedAt: string | null;
    criteriaDistribution: CriteriaDistribution;
    eventCount: number;
    hasCompletedBrief: boolean;
    href: string;
    id: string;
    jobTitle: string;
    limitationsCount: number;
    pointsToClarifyCount: number | null;
    questionCompletionRate: number | null;
    realtimeSessionId: string | null;
    reviewNotePreview: string | null;
    reviewNoteUpdatedAt: string | null;
    reviewStatus: RecruiterReviewStatus;
    reviewStatusUpdatedAt: string | null;
    roleTitle: string;
    startedAt: string | null;
    status: string;
    transcriptTurnCount: number;
  }>;
  connectors: Array<{
    provider: string;
    status: string;
  }>;
  primaryReviewHref: string | null;
};

const activeCandidateStatuses = new Set([
  "agent_joining",
  "created",
  "in_progress",
  "paused",
  "started",
  "waiting_candidate",
]);

export async function getConsoleDashboardData(): Promise<ConsoleDashboardData> {
  const scope = await getCompletedOrganizationScope();

  const [organization, draftCount, publishedCount, candidateSessions] =
    await Promise.all([
      prisma.organization.findUniqueOrThrow({
        include: {
          jobSourceConnections: {
            orderBy: { createdAt: "desc" },
          },
          jobs: {
            include: {
              interviewDrafts: {
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
              interviews: {
                include: {
                  candidateSessions: {
                    orderBy: { updatedAt: "desc" },
                  },
                },
                orderBy: { updatedAt: "desc" },
                take: 1,
              },
            },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
        where: { id: scope.organizationId },
      }),
      prisma.interviewDraft.count({
        where: {
          organizationId: scope.organizationId,
          status: "draft",
        },
      }),
      prisma.interview.count({
        where: {
          organizationId: scope.organizationId,
          status: "published",
        },
      }),
      listCandidateSessionSpinesForOrganization({
        organizationId: scope.organizationId,
      }),
    ]);

  const realtimeSessionIds = candidateSessions
    .map((session) => session.realtimeSessionId)
    .filter((id): id is string => Boolean(id));
  const [liveStatusById, eventStatsBySessionId] = await Promise.all([
    getLiveStatusById(realtimeSessionIds),
    getLiveEventStatsBySessionId(realtimeSessionIds),
  ]);
  const completed = candidateSessions.filter(
    (session) =>
      currentCandidateStatus(session, liveStatusById) === "completed",
  );
  const needsReview = completed.filter(
    (session) => resolveReviewStatus(session.reviewStatus) === "to_review",
  );
  const active = candidateSessions.filter((session) =>
    activeCandidateStatuses.has(
      currentCandidateStatus(session, liveStatusById),
    ),
  );

  const roles = organization.jobs.map((job) => {
    const interview = job.interviews[0];
    const draft = job.interviewDrafts[0];
    const state = resolveInterviewState({
      draftStatus: draft?.status,
      interviewStatus: interview?.status,
      sessions: interview?.candidateSessions ?? [],
      liveStatusById,
    });

    return {
      candidateCount: interview?.candidateSessions.length ?? 0,
      candidatePath: interview ? `/interview/${interview.publicToken}` : null,
      description:
        interview?.roleBrief ?? draft?.roleBrief ?? job.description ?? "",
      href: interview
        ? `/roles/${interview.id}`
        : draft
          ? `/roles/new?draftId=${draft.id}`
          : `/roles/new?jobId=${job.id}`,
      id: interview?.id ?? draft?.id ?? job.id,
      jobId: job.id,
      location: job.location,
      sourceProvider: job.sourceProvider,
      state,
      title: interview?.roleTitle ?? draft?.roleTitle ?? job.title,
      updatedAt:
        interview?.updatedAt.toISOString() ??
        draft?.updatedAt.toISOString() ??
        job.createdAt.toISOString(),
    };
  });

  const latestCompleted = candidateSessions.find(
    (session) =>
      currentCandidateStatus(session, liveStatusById) === "completed",
  );
  const latestRole = roles[0];
  const reviewQueue = candidateSessions.map((session) => {
    const status = currentCandidateStatus(session, liveStatusById);
    const eventStats = session.realtimeSessionId
      ? eventStatsBySessionId.get(session.realtimeSessionId)
      : undefined;
    const questionCount = readJsonArray(session.interview.questions).length;
    const brief = toCandidateBriefDto(session.candidateBrief);
    const reviewSignals = getCandidateReviewSignals(brief);

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
      href: `/interviews/${session.realtimeSessionId ?? session.id}`,
      id: session.id,
      jobTitle: session.job.title,
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
      reviewStatusUpdatedAt:
        session.reviewStatusUpdatedAt?.toISOString() ?? null,
      roleTitle: session.interview.roleTitle,
      startedAt: session.startedAt?.toISOString() ?? null,
      status,
      transcriptTurnCount: eventStats?.transcriptTurnCount ?? 0,
    };
  });

  return {
    connectors: organization.jobSourceConnections.map((connector) => ({
      provider: connector.provider,
      status: connector.status,
    })),
    metrics: {
      activeRoles: organization.jobs.length,
      candidateStarted: active.length,
      completed: completed.length,
      drafts: draftCount,
      needsReview: needsReview.length,
      published: publishedCount,
    },
    organization: {
      id: organization.id,
      companySize: organization.companySize,
      defaultInterviewMode: organization.defaultInterviewMode,
      hiringFocus: organization.hiringFocus,
      name: organization.name,
    },
    primaryReviewHref: latestCompleted
      ? `/interviews/${latestCompleted.realtimeSessionId ?? latestCompleted.id}`
      : (latestRole?.href ?? null),
    reviewQueue,
    roles,
  };
}

function resolveInterviewState({
  draftStatus,
  interviewStatus,
  liveStatusById,
  sessions,
}: {
  draftStatus?: string;
  interviewStatus?: string;
  sessions: Array<{
    realtimeSessionId: string | null;
    reviewStatus?: string | null;
    status: string;
  }>;
  liveStatusById: Map<string, string>;
}): DashboardRoleScreenState {
  const completedSessions = sessions.filter(
    (session) => currentCandidateStatus(session, liveStatusById) === "completed",
  );

  if (
    completedSessions.some(
      (session) => resolveReviewStatus(session.reviewStatus) === "to_review",
    )
  ) {
    return "needs_review";
  }

  const statuses = sessions.map((session) =>
    currentCandidateStatus(session, liveStatusById),
  );

  if (completedSessions.length > 0) {
    return "completed";
  }

  if (statuses.some((status) => activeCandidateStatuses.has(status))) {
    return "candidate_started";
  }

  if (interviewStatus === "published") {
    return "published";
  }

  if (interviewStatus === "paused") {
    return "paused";
  }

  if (draftStatus === "published") {
    return "published";
  }

  return "draft";
}

function currentCandidateStatus(
  session: {
    realtimeSessionId?: string | null;
    status: string;
  },
  liveStatusById: Map<string, string>,
) {
  return (
    (session.realtimeSessionId
      ? liveStatusById.get(session.realtimeSessionId)
      : undefined) ?? session.status
  );
}

function readJsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}
