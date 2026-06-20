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
import { listCandidateSessionSpinesForOrganization } from "../interviews/candidate-session-spine";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

export type DashboardInterviewState =
  | "draft"
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
  interviews: Array<{
    candidateCount: number;
    description: string;
    href: string;
    id: string;
    jobId: string;
    location: string | null;
    sourceProvider: string | null;
    state: DashboardInterviewState;
    title: string;
    updatedAt: string;
  }>;
  reviewQueue: Array<{
    analysisStatus: LiveAnalysisStatus;
    candidateLabel: string;
    completedAt: string | null;
    eventCount: number;
    href: string;
    id: string;
    jobTitle: string;
    questionCompletionRate: number | null;
    realtimeSessionId: string | null;
    reviewStatus: RecruiterReviewStatus;
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

  const interviews = organization.jobs.map((job) => {
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
      description:
        interview?.roleBrief ?? draft?.roleBrief ?? job.description ?? "",
      href: interview
        ? `/interviews/${interview.id}`
        : draft
          ? `/interviews/new?draftId=${draft.id}`
          : `/interviews/new?jobId=${job.id}`,
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
  const latestInterview = interviews[0];
  const reviewQueue = candidateSessions.slice(0, 8).map((session) => {
    const status = currentCandidateStatus(session, liveStatusById);
    const eventStats = session.realtimeSessionId
      ? eventStatsBySessionId.get(session.realtimeSessionId)
      : undefined;
    const questionCount = readJsonArray(session.interview.questions).length;

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
      eventCount: eventStats?.eventCount ?? 0,
      href: `/interviews/${session.realtimeSessionId ?? session.id}`,
      id: session.id,
      jobTitle: session.job.title,
      questionCompletionRate: getQuestionCompletionRate({
        questionCount,
        stats: eventStats,
      }),
      realtimeSessionId: session.realtimeSessionId,
      reviewStatus: resolveReviewStatus(session.reviewStatus),
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
    interviews,
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
      : (latestInterview?.href ?? null),
    reviewQueue,
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
    status: string;
  }>;
  liveStatusById: Map<string, string>;
}): DashboardInterviewState {
  const statuses = sessions.map((session) =>
    currentCandidateStatus(session, liveStatusById),
  );

  if (statuses.includes("completed")) {
    return "needs_review";
  }

  if (statuses.some((status) => activeCandidateStatuses.has(status))) {
    return "candidate_started";
  }

  if (interviewStatus === "published") {
    return "published";
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
