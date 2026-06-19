import "server-only";

import { prisma } from "@prelude/db";
import type {
  InterviewAgentDraft,
  InterviewCriterionDraft,
  InterviewFocus,
  InterviewQuestionDraft,
  InterviewSeniority,
} from "@prelude/core";

import type { InterviewResponseMode } from "./interview-drafts";
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
        interviewId: string;
        roleTitle: string;
      };
    };

export type CandidateSessionSummary = {
  completedAt: string | null;
  id: string;
  realtimeSessionId: string | null;
  startedAt: string | null;
  status: string;
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
    const liveStatusById = await getLiveStatusById(
      interview.candidateSessions
        .map((session) => session.realtimeSessionId)
        .filter((id): id is string => Boolean(id)),
    );

    return {
      interview: {
        candidatePath: `/interview/${interview.publicToken}`,
        candidateSessions: interview.candidateSessions.map((session) =>
          toCandidateSessionSummary(session, liveStatusById),
        ),
        criteria: readCriteria(interview.criteria),
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

  const candidateSession = await prisma.candidateSession.findFirst({
    include: {
      interview: true,
    },
    where: {
      organizationId: scope.organizationId,
      OR: [{ id: idOrSessionId }, { realtimeSessionId: idOrSessionId }],
    },
  });

  if (candidateSession) {
    const liveStatusById = await getLiveStatusById(
      candidateSession.realtimeSessionId ? [candidateSession.realtimeSessionId] : [],
    );

    return {
      candidateSession: {
        ...toCandidateSessionSummary(candidateSession, liveStatusById),
        interviewId: candidateSession.interviewId,
        roleTitle: candidateSession.interview.roleTitle,
      },
      kind: "candidate_session",
      organizationName: organization.name,
    };
  }

  const realtimeSession = await prisma.liveInterviewSession.findUnique({
    where: { id: idOrSessionId },
  });

  if (!realtimeSession) {
    return null;
  }

  const realtimeInterview = await prisma.interview.findFirst({
    where: {
      id: realtimeSession.interviewPlanId,
      organizationId: scope.organizationId,
    },
  });

  if (!realtimeInterview) {
    return null;
  }

  return {
    candidateSession: {
      completedAt:
        realtimeSession.status === "completed"
          ? realtimeSession.updatedAt.toISOString()
          : null,
      id: realtimeSession.candidateId,
      interviewId: realtimeInterview.id,
      realtimeSessionId: realtimeSession.id,
      roleTitle: realtimeInterview.roleTitle,
      startedAt: realtimeSession.createdAt.toISOString(),
      status: realtimeSession.status,
    },
    kind: "candidate_session",
    organizationName: organization.name,
  };
}

function toCandidateSessionSummary(session: {
  completedAt: Date | null;
  id: string;
  realtimeSessionId: string | null;
  startedAt: Date | null;
  status: string;
  updatedAt: Date;
}, liveStatusById: Map<string, string>): CandidateSessionSummary {
  const status =
    (session.realtimeSessionId
      ? liveStatusById.get(session.realtimeSessionId)
      : undefined) ?? session.status;

  return {
    completedAt:
      session.completedAt?.toISOString() ??
      (status === "completed" ? session.updatedAt.toISOString() : null),
    id: session.id,
    realtimeSessionId: session.realtimeSessionId,
    startedAt: session.startedAt?.toISOString() ?? null,
    status,
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

async function getLiveStatusById(sessionIds: string[]) {
  if (sessionIds.length === 0) {
    return new Map<string, string>();
  }

  const liveSessions = await prisma.liveInterviewSession.findMany({
    select: {
      id: true,
      status: true,
    },
    where: {
      id: { in: sessionIds },
    },
  });

  return new Map(liveSessions.map((session) => [session.id, session.status]));
}
