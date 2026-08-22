import "server-only";

import { prisma, type Prisma } from "@prelude/db";

import {
  getLiveEventStatsBySessionId,
  getLiveStatusById,
  getQuestionCompletionRate,
  resolveAnalysisStatus,
  resolveReviewStatus,
  type LiveEventStats,
  type LiveAnalysisStatus,
  type RecruiterReviewStatus,
} from "../interviews/live-session-insights";
import {
  getCandidateReviewSignals,
  toCandidateBriefDto,
  type CriteriaDistribution,
} from "../interviews/candidate-review-signals";
import { getReviewNotePreview } from "../interviews/candidate-review-display";
import {
  listCandidateSessionSpinesForOrganization,
  type CandidateSessionSpine,
} from "../interviews/candidate-session-spine";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import {
  CONSOLE_LIST_PAGE_SIZE,
  decodeCursor,
  pageFromRows,
  previousCursorFromRows,
} from "./cursor-pagination";
import type { CandidateListQuery, RoleListQuery } from "./list-query";

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

const dashboardPreviewSize = 8;

export type ConsoleRoleListData = {
  counts: Record<Exclude<RoleListQuery["filter"], "all"> | "all", number>;
  nextCursor: string | null;
  organizationName: string;
  previousCursor: string | null;
  roles: ConsoleDashboardData["roles"];
};

export type ConsoleCandidateListData = {
  candidates: ConsoleDashboardData["reviewQueue"];
  counts: Record<Exclude<CandidateListQuery["filter"], "all"> | "all", number>;
  nextCursor: string | null;
  organizationName: string;
  previousCursor: string | null;
};

export async function getConsoleDashboardData(): Promise<ConsoleDashboardData> {
  const scope = await getCompletedOrganizationScope();

  const [
    organization,
    draftCount,
    publishedCount,
    activeRoleCount,
    completedCount,
    candidateStartedCount,
    needsReviewCount,
    candidateSessions,
  ] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      include: {
        jobSourceConnections: {
          orderBy: { createdAt: "desc" },
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
    prisma.job.count({ where: { organizationId: scope.organizationId } }),
    prisma.candidateSession.count({
      where: { organizationId: scope.organizationId, status: "completed" },
    }),
    prisma.candidateSession.count({
      where: {
        organizationId: scope.organizationId,
        status: { in: [...activeCandidateStatuses] },
      },
    }),
    prisma.candidateSession.count({
      where: {
        organizationId: scope.organizationId,
        reviewStatus: "to_review",
        status: "completed",
      },
    }),
    listCandidateSessionSpinesForOrganization({
      organizationId: scope.organizationId,
      take: dashboardPreviewSize,
    }),
  ]);

  const realtimeSessionIds = candidateSessions
    .map((session) => session.realtimeSessionId)
    .filter((id): id is string => Boolean(id));
  const [liveStatusById, eventStatsBySessionId] = await Promise.all([
    getLiveStatusById(realtimeSessionIds),
    getLiveEventStatsBySessionId(realtimeSessionIds),
  ]);
  const roles = (
    await listConsoleRoles({
      organizationId: scope.organizationId,
      take: dashboardPreviewSize,
    })
  ).roles;

  const latestCompleted = candidateSessions.find(
    (session) =>
      currentCandidateStatus(session, liveStatusById) === "completed",
  );
  const latestRole = roles[0];
  const reviewQueue = toReviewQueueItems({
    candidateSessions,
    eventStatsBySessionId,
    liveStatusById,
  });

  return {
    connectors: organization.jobSourceConnections.map((connector) => ({
      provider: connector.provider,
      status: connector.status,
    })),
    metrics: {
      activeRoles: activeRoleCount,
      candidateStarted: candidateStartedCount,
      completed: completedCount,
      drafts: draftCount,
      needsReview: needsReviewCount,
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

export async function getConsoleRolesData({
  cursor,
  filter = "all",
  q = "",
  sort = "recent",
}: {
  cursor?: string | null;
  filter?: RoleListQuery["filter"];
  q?: string;
  sort?: RoleListQuery["sort"];
} = {}): Promise<ConsoleRoleListData> {
  const scope = await getCompletedOrganizationScope();
  const cursorState = decodeCursor(cursor);
  const query = roleListWhere({ filter, organizationId: scope.organizationId, q });
  const [organization, result, counts] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      select: { name: true },
      where: { id: scope.organizationId },
    }),
    listConsoleRoles({
      cursor: cursorState,
      organizationId: scope.organizationId,
      sort,
      take: CONSOLE_LIST_PAGE_SIZE,
      where: query,
    }),
    getRoleListCounts({ organizationId: scope.organizationId, q }),
  ]);

  return {
    counts,
    nextCursor: result.nextCursor,
    organizationName: organization.name,
    previousCursor: result.previousCursor,
    roles: result.roles,
  };
}

export async function getConsoleCandidatesData({
  cursor,
  filter = "all",
  q = "",
  sort = "recent",
}: {
  cursor?: string | null;
  filter?: CandidateListQuery["filter"];
  q?: string;
  sort?: CandidateListQuery["sort"];
} = {}): Promise<ConsoleCandidateListData> {
  const scope = await getCompletedOrganizationScope();
  const cursorState = decodeCursor(cursor);
  const where = candidateListWhere({ filter, q });
  const orderBy = candidateListOrderBy(sort);
  const [organization, sessions, counts] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      select: { name: true },
      where: { id: scope.organizationId },
    }),
    listCandidateSessionSpinesForOrganization({
      cursor: cursorState,
      orderBy,
      organizationId: scope.organizationId,
      take: CONSOLE_LIST_PAGE_SIZE + 1,
      where,
    }),
    getCandidateListCounts({ organizationId: scope.organizationId, q }),
  ]);
  const page = pageFromRows(sessions, CONSOLE_LIST_PAGE_SIZE);
  const previousRows = cursorState
    ? await prisma.candidateSession.findMany({
        cursor: { id: cursorState },
        orderBy: reverseCandidateListOrderBy(sort),
        select: { id: true },
        skip: 1,
        take: CONSOLE_LIST_PAGE_SIZE + 1,
        where: { organizationId: scope.organizationId, ...where },
      })
    : [];
  const realtimeSessionIds = page.items
    .map((session) => session.realtimeSessionId)
    .filter((id): id is string => Boolean(id));
  const [liveStatusById, eventStatsBySessionId] = await Promise.all([
    getLiveStatusById(realtimeSessionIds),
    getLiveEventStatsBySessionId(realtimeSessionIds),
  ]);

  return {
    candidates: toReviewQueueItems({
      candidateSessions: page.items,
      eventStatsBySessionId,
      liveStatusById,
    }),
    counts,
    nextCursor: page.nextCursor,
    organizationName: organization.name,
    previousCursor: previousCursorFromRows(previousRows),
  };
}

async function listConsoleRoles({
  cursor,
  organizationId,
  sort = "recent",
  take,
  where,
}: {
  cursor?: string | null;
  organizationId: string;
  sort?: RoleListQuery["sort"];
  take: number;
  where?: Prisma.JobWhereInput;
}) {
  const jobs = await prisma.job.findMany({
    cursor: cursor ? { id: cursor } : undefined,
    include: {
      _count: { select: { candidateSessions: true } },
      interviewDrafts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      interviews: {
        include: {
          candidateInvitations: {
            orderBy: { createdAt: "desc" },
            take: 1,
            where: {
              expiresAt: { gt: new Date() },
              status: { notIn: ["completed", "expired", "superseded"] },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    orderBy: roleListOrderBy(sort),
    skip: cursor ? 1 : undefined,
    take: take + 1,
    where: { organizationId, ...where },
  });
  const page = pageFromRows(jobs, take);
  const previousRows = cursor
    ? await prisma.job.findMany({
        cursor: { id: cursor },
        orderBy: reverseRoleListOrderBy(sort),
        select: { id: true },
        skip: 1,
        take: take + 1,
        where: { organizationId, ...where },
      })
    : [];
  const jobIds = page.items.map((job) => job.id);
  const sessionGroups = jobIds.length
    ? await prisma.candidateSession.groupBy({
        _count: { _all: true },
        by: ["jobId", "reviewStatus", "status"],
        where: { jobId: { in: jobIds }, organizationId },
      })
    : [];
  const groupsByJobId = new Map<string, typeof sessionGroups>();

  for (const group of sessionGroups) {
    const groups = groupsByJobId.get(group.jobId) ?? [];
    groups.push(group);
    groupsByJobId.set(group.jobId, groups);
  }

  return {
    nextCursor: page.nextCursor,
    previousCursor: previousCursorFromRows(previousRows, take),
    roles: page.items.map((job) => {
      const interview = job.interviews[0];
      const draft = job.interviewDrafts[0];

      return {
        candidateCount: job._count.candidateSessions,
        candidatePath: interview ? candidatePathForInterview(interview) : null,
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
        state: resolveRoleState({
          draftStatus: draft?.status,
          interviewStatus: interview?.status,
          sessionGroups: groupsByJobId.get(job.id) ?? [],
        }),
        title: interview?.roleTitle ?? draft?.roleTitle ?? job.title,
        updatedAt:
          interview?.updatedAt.toISOString() ??
          draft?.updatedAt.toISOString() ??
          job.createdAt.toISOString(),
      };
    }),
  };
}

function roleListWhere({
  filter,
  organizationId,
  q,
}: {
  filter: RoleListQuery["filter"];
  organizationId: string;
  q: string;
}): Prisma.JobWhereInput {
  const search = q
    ? {
        OR: [
          { location: { contains: q, mode: "insensitive" as const } },
          { sourceProvider: { contains: q, mode: "insensitive" as const } },
          { title: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  if (filter === "needs_review") {
    return {
      ...search,
      candidateSessions: {
        some: {
          status: "completed",
          reviewStatus: "to_review",
        },
      },
      organizationId,
    };
  }

  if (filter === "completed") {
    return {
      ...search,
      AND: [
        { candidateSessions: { some: { status: "completed" } } },
        {
          NOT: {
            candidateSessions: {
              some: {
                status: "completed",
                reviewStatus: "to_review",
              },
            },
          },
        },
      ],
      organizationId,
    };
  }

  if (filter === "live") {
    return {
      ...search,
      AND: [
        {
          NOT: {
            candidateSessions: {
              some: {
                status: "completed",
                reviewStatus: "to_review",
              },
            },
          },
        },
        { NOT: { candidateSessions: { some: { status: "completed" } } } },
        {
          OR: [
            {
              candidateSessions: {
                some: { status: { in: [...activeCandidateStatuses] } },
              },
            },
            { interviews: { some: { status: "published" } } },
            { interviewDrafts: { some: { status: "published" } } },
          ],
        },
      ],
      organizationId,
    };
  }

  if (filter === "draft") {
    return {
      ...search,
      AND: [
        { NOT: { candidateSessions: { some: { status: "completed" } } } },
        {
          NOT: {
            candidateSessions: {
              some: { status: { in: [...activeCandidateStatuses] } },
            },
          },
        },
        { NOT: { interviews: { some: { status: "published" } } } },
        { NOT: { interviewDrafts: { some: { status: "published" } } } },
      ],
      organizationId,
    };
  }

  return { ...search, organizationId };
}

function roleListOrderBy(sort: RoleListQuery["sort"]): Prisma.JobOrderByWithRelationInput[] {
  return sort === "alpha"
    ? [{ title: "asc" }, { id: "asc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];
}

function reverseRoleListOrderBy(
  sort: RoleListQuery["sort"],
): Prisma.JobOrderByWithRelationInput[] {
  return sort === "alpha"
    ? [{ title: "desc" }, { id: "desc" }]
    : [{ createdAt: "asc" }, { id: "asc" }];
}

async function getRoleListCounts({
  organizationId,
  q,
}: {
  organizationId: string;
  q: string;
}): Promise<ConsoleRoleListData["counts"]> {
  const filters = ["all", "live", "needs_review", "draft", "completed"] as const;
  const results = await Promise.all(
    filters.map((filter) =>
      prisma.job.count({ where: roleListWhere({ filter, organizationId, q }) }),
    ),
  );

  return Object.fromEntries(
    filters.map((filter, index) => [filter, results[index]]),
  ) as ConsoleRoleListData["counts"];
}

function candidateListWhere({
  filter,
  q,
}: {
  filter: CandidateListQuery["filter"];
  q: string;
}): Prisma.CandidateSessionWhereInput {
  const search = q
    ? {
        OR: [
          { candidateEmail: { contains: q, mode: "insensitive" as const } },
          { candidateName: { contains: q, mode: "insensitive" as const } },
          { interview: { roleTitle: { contains: q, mode: "insensitive" as const } } },
          { job: { title: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  return {
    ...search,
    ...(filter === "all" ? {} : { reviewStatus: filter }),
  };
}

function candidateListOrderBy(
  sort: CandidateListQuery["sort"],
): Prisma.CandidateSessionOrderByWithRelationInput[] {
  if (sort === "name") {
    return [{ candidateName: "asc" }, { id: "asc" }];
  }

  if (sort === "review") {
    return [{ reviewStatus: "asc" }, { updatedAt: "desc" }, { id: "desc" }];
  }

  return [{ updatedAt: "desc" }, { id: "desc" }];
}

function reverseCandidateListOrderBy(
  sort: CandidateListQuery["sort"],
): Prisma.CandidateSessionOrderByWithRelationInput[] {
  if (sort === "name") {
    return [{ candidateName: "desc" }, { id: "desc" }];
  }

  if (sort === "review") {
    return [{ reviewStatus: "desc" }, { updatedAt: "asc" }, { id: "asc" }];
  }

  return [{ updatedAt: "asc" }, { id: "asc" }];
}

async function getCandidateListCounts({
  organizationId,
  q,
}: {
  organizationId: string;
  q: string;
}): Promise<ConsoleCandidateListData["counts"]> {
  const filters = ["all", "to_review", "to_call", "archived"] as const;
  const results = await Promise.all(
    filters.map((filter) =>
      prisma.candidateSession.count({
        where: { organizationId, ...candidateListWhere({ filter, q }) },
      }),
    ),
  );

  return Object.fromEntries(
    filters.map((filter, index) => [filter, results[index]]),
  ) as ConsoleCandidateListData["counts"];
}

function toReviewQueueItems({
  candidateSessions,
  eventStatsBySessionId,
  liveStatusById,
}: {
  candidateSessions: CandidateSessionSpine[];
  eventStatsBySessionId: Map<string, LiveEventStats>;
  liveStatusById: Map<string, string>;
}): ConsoleDashboardData["reviewQueue"] {
  return candidateSessions.map((session) => {
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
}

function candidatePathForInterview(interview: {
  candidateInvitations?: Array<{ token: string }>;
  publicToken: string;
}) {
  return `/interview/${
    interview.candidateInvitations?.[0]?.token ?? interview.publicToken
  }`;
}

function resolveRoleState({
  draftStatus,
  interviewStatus,
  sessionGroups,
}: {
  draftStatus?: string;
  interviewStatus?: string;
  sessionGroups: Array<{
    reviewStatus: string | null;
    status: string;
  }>;
}): DashboardRoleScreenState {
  if (
    sessionGroups.some(
      (session) =>
        session.status === "completed" &&
        resolveReviewStatus(session.reviewStatus) === "to_review",
    )
  ) {
    return "needs_review";
  }

  if (sessionGroups.some((session) => session.status === "completed")) {
    return "completed";
  }

  if (
    sessionGroups.some((session) => activeCandidateStatuses.has(session.status))
  ) {
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
