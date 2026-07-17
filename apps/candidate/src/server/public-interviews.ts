import { randomBytes } from "node:crypto";

import {
  candidateConsentCopyVersion,
  mapRealtimeStatusToCandidateLifecycleStatus,
  normalizeCandidateLifecycleStatus,
  resolveCandidateStartPolicy,
} from "@prelude/core";
import { prisma } from "@prelude/db";
import { createNotificationDispatcher } from "@prelude/notifications";
import type { Prisma } from "@prelude/db";

const notificationDispatcher = createNotificationDispatcher();

type PublicCandidateInvitation = {
  candidateEmail: string | null;
  candidateName: string | null;
  expiresAt: Date;
  id: string;
  status: string;
  token: string;
} | null;

export type PublicInterviewQuestion = {
  id: string;
  prompt: string;
  signal: string | null;
};

export type PublicInterviewContext =
  | {
      kind: "published";
      invitation: PublicCandidateInvitation;
      interview: {
        companyName: string;
        estimatedMinutes: number | null;
        id: string;
        jobId: string;
        jobTitle: string;
        organizationId: string;
        publicToken: string;
        questions: PublicInterviewQuestion[];
        responseModes: string[];
        roleTitle: string;
      };
    }
  | {
      kind: "not_found";
    };

export type StartCandidateInterviewInput = {
  candidateEmail?: string;
  candidateName?: string;
  candidateToken: string;
  consentAccepted: boolean;
  requestedModality?: "audio" | "form";
  resumeToken?: string;
  videoEnabled?: boolean;
};

type PrepareCandidateSessionError =
  | "candidate_session_already_completed"
  | "candidate_session_expired"
  | "candidate_session_not_resumable"
  | "candidate_session_superseded"
  | "consent_required"
  | "form_fallback_unavailable"
  | "interview_not_found";

export type CompleteCandidateSessionInput = {
  resumeToken?: string | null;
  sessionId: string;
};

export type MarkCandidateSessionLifecycleInput = {
  action: "abandon" | "fail";
  resumeToken?: string | null;
  sessionId: string;
};

export type SubmitCandidateFormInterviewInput = {
  answers: Array<{
    questionId: string;
    text: string;
  }>;
  candidateEmail?: string;
  candidateName?: string;
  candidateToken: string;
  consentAccepted: boolean;
  resumeToken?: string | null;
};

const completableCandidateSessionStatuses = [
  "agent_joining",
  "in_progress",
  "paused",
  "reconnecting",
  "started",
  "starting",
  "waiting_candidate",
] as const;

const activeCandidateSessionStatuses = [
  ...completableCandidateSessionStatuses,
] as const;

export async function getPublicInterviewContext(
  candidateToken: string,
): Promise<PublicInterviewContext> {
  const token = candidateToken.trim();

  if (!token) {
    return { kind: "not_found" };
  }

  if (!process.env.DATABASE_URL) {
    return { kind: "not_found" };
  }

  const invitation = await prisma.candidateInvitation.findUnique({
    include: {
      interview: {
        include: {
          job: true,
          organization: true,
        },
      },
    },
    where: { token },
  });

  if (invitation?.interview.status === "published") {
    const now = new Date();
    if (invitation.expiresAt <= now) {
      await prisma.candidateInvitation.updateMany({
        data: { status: "expired" },
        where: {
          id: invitation.id,
          status: { notIn: ["completed", "expired", "superseded"] },
        },
      });
    } else if (!invitation.openedAt) {
      await prisma.candidateInvitation.updateMany({
        data: {
          openedAt: now,
          status:
            invitation.status === "invited" ? "opened" : invitation.status,
        },
        where: { id: invitation.id },
      });
    }

    return toPublishedInterviewContext({
      interview: invitation.interview,
      invitation: {
        candidateEmail: invitation.candidateEmail,
        candidateName: invitation.candidateName,
        expiresAt: invitation.expiresAt,
        id: invitation.id,
        status:
          invitation.expiresAt <= now && invitation.status !== "completed"
            ? "expired"
            : invitation.status,
        token: invitation.token,
      },
    });
  }

  const interview = await prisma.interview.findFirst({
    include: {
      job: true,
      organization: true,
    },
    where: {
      publicToken: token,
      status: "published",
    },
  });

  if (!interview) {
    return { kind: "not_found" };
  }

  return toPublishedInterviewContext({ interview, invitation: null });
}

export async function prepareCandidateSession(
  input: StartCandidateInterviewInput,
) {
  const token = input.candidateToken.trim();
  const context = await getPublicInterviewContext(token);

  if (context.kind === "not_found") {
    return {
      ok: false as const,
      error: "interview_not_found" as const,
      status: 404,
    };
  }

  const allowedModalities = resolveAllowedModalities(
    context.interview.responseModes,
    input.videoEnabled,
  );
  if (
    input.requestedModality === "form" &&
    !allowedModalities.includes("form")
  ) {
    return {
      ok: false as const,
      error: "form_fallback_unavailable" as const,
      status: 400,
    };
  }

  const now = new Date();
  if (context.invitation) {
    const invitationStatus = normalizeCandidateLifecycleStatus(
      context.invitation.status,
    );

    if (context.invitation.expiresAt <= now || invitationStatus === "expired") {
      await prisma.candidateInvitation.updateMany({
        data: { status: "expired" },
        where: { id: context.invitation.id },
      });
      return {
        ok: false as const,
        error: "candidate_session_expired" as const,
        status: 410,
      };
    }

    if (invitationStatus === "completed") {
      return {
        ok: false as const,
        error: "candidate_session_already_completed" as const,
        status: 409,
      };
    }

    if (invitationStatus === "superseded") {
      return {
        ok: false as const,
        error: "candidate_session_superseded" as const,
        status: 409,
      };
    }
  }

  if (!input.consentAccepted) {
    if (context.invitation) {
      await prisma.candidateInvitation.updateMany({
        data: { status: "consent_required" },
        where: {
          id: context.invitation.id,
          status: { notIn: ["completed", "expired", "superseded"] },
        },
      });
    }

    return {
      ok: false as const,
      error: "consent_required" as const,
      status: 400,
    };
  }

  const candidateEmail = normalizeEmail(input.candidateEmail);
  const candidateName = normalizeName(input.candidateName);
  const existingSession = input.resumeToken
    ? await prisma.candidateSession.findFirst({
        where: {
          ...(context.invitation
            ? { candidateInvitationId: context.invitation.id }
            : {}),
          interviewId: context.interview.id,
          resumeToken: input.resumeToken,
        },
      })
    : context.invitation
      ? await prisma.candidateSession.findFirst({
          orderBy: { updatedAt: "desc" },
          where: {
            candidateInvitationId: context.invitation.id,
            status: { in: [...activeCandidateSessionStatuses] },
          },
        })
      : null;
  const startPolicy = existingSession
    ? resolveCandidateStartPolicy(existingSession.status)
    : ({ action: "start_new_attempt", reason: null } as const);

  if (
    context.invitation &&
    existingSession &&
    !input.resumeToken &&
    startPolicy.action === "resume_same_attempt"
  ) {
    return {
      ok: false as const,
      error: "candidate_session_not_resumable" as const,
      status: 409,
    };
  }

  if (startPolicy.action === "reject") {
    return {
      ok: false as const,
      error: toCandidateStartError(startPolicy.reason),
      status: startPolicy.reason === "expired" ? 410 : 409,
    };
  }

  const shouldResumeExisting =
    existingSession && startPolicy.action === "resume_same_attempt";
  const productSession = shouldResumeExisting
    ? await prisma.candidateSession.update({
        data: {
          candidateEmail,
          candidateName,
          candidateInvitationId: context.invitation?.id,
          consentCopyVersion: candidateConsentCopyVersion,
          // Re-consent re-timestamps: resuming requires accepting the current
          // copy again (consent gate above), so stamp the consent moment as now.
          // Carrying an old consentedAt under the current version label would make
          // the audit assert "consented to vN at T" where T predates vN.
          consentedAt: now,
          startedAt: existingSession.startedAt ?? now,
          status: "starting",
        },
        where: { id: existingSession.id },
      })
    : await prisma.candidateSession.create({
        data: {
          candidateEmail,
          candidateName,
          candidateInvitationId: context.invitation?.id,
          consentCopyVersion: candidateConsentCopyVersion,
          consentedAt: now,
          interviewId: context.interview.id,
          jobId: context.interview.jobId,
          organizationId: context.interview.organizationId,
          resumeToken: createResumeToken(),
          startedAt: now,
          status: "starting",
        },
      });

  if (context.invitation) {
    await prisma.candidateInvitation.updateMany({
      data: {
        candidateEmail,
        candidateName,
        consentCopyVersion: candidateConsentCopyVersion,
        consentedAt: now,
        status: "starting",
      },
      where: {
        id: context.invitation.id,
        status: { notIn: ["completed", "expired", "superseded"] },
      },
    });
  }

  return {
    ok: true as const,
    allowedModalities,
    candidateId: productSession.id,
    interviewPlanId: context.interview.id,
    productSession,
    resumeToken: productSession.resumeToken,
    candidateInvitationId: context.invitation?.id ?? null,
    supersededSessionId:
      existingSession && startPolicy.action === "retry_new_attempt"
        ? existingSession.id
        : null,
  };
}

export function resolveAllowedModalities(
  value: unknown,
  _videoEnabled = false,
) {
  const modes = resolvePublicResponseModes(value);
  const allowed = new Set<string>();

  if (modes.includes("text") || modes.includes("form")) {
    allowed.add("form");
  }

  if (modes.includes("audio") || modes.length === 0) {
    allowed.add("audio");
  }

  if (allowed.size === 0) {
    allowed.add("audio");
  }

  return [...allowed];
}

export async function completeCandidateSession(
  input: CompleteCandidateSessionInput,
) {
  const resumeToken = input.resumeToken?.trim();

  if (!input.sessionId || !resumeToken) {
    return { ok: false as const, status: 400 };
  }

  const result = await prisma.candidateSession.updateMany({
    data: {
      completedAt: new Date(),
      status: "completed",
    },
    where: {
      id: input.sessionId,
      resumeToken,
      status: {
        in: [...completableCandidateSessionStatuses],
      },
    },
  });

  if (result.count > 0) {
    await updateCandidateInvitationStatusForSession({
      resumeToken,
      sessionId: input.sessionId,
      status: "completed",
    });
    await notifyCandidateInterviewCompleted(input.sessionId);
    return { ok: true as const };
  }

  const existingSession = await prisma.candidateSession.findFirst({
    select: { status: true },
    where: {
      id: input.sessionId,
      resumeToken,
    },
  });

  if (!existingSession) {
    return {
      ok: false as const,
      error: "candidate_session_not_found" as const,
      status: 404,
    };
  }

  if (
    normalizeCandidateLifecycleStatus(existingSession.status) === "completed"
  ) {
    await updateCandidateInvitationStatusForSession({
      resumeToken,
      sessionId: input.sessionId,
      status: "completed",
    });
    await notifyCandidateInterviewCompleted(input.sessionId);
    return { ok: true as const };
  }

  return {
    ok: false as const,
    error: "candidate_session_not_completable" as const,
    status: 409,
  };
}

export async function markCandidateSessionLifecycle(
  input: MarkCandidateSessionLifecycleInput,
) {
  const resumeToken = input.resumeToken?.trim();

  if (!input.sessionId || !resumeToken) {
    return {
      ok: false as const,
      error: "candidate_session_not_found" as const,
      status: 400,
    };
  }

  const nextStatus = input.action === "abandon" ? "abandoned" : "failed";
  const result = await prisma.candidateSession.updateMany({
    data: {
      status: nextStatus,
    },
    where: {
      id: input.sessionId,
      resumeToken,
      status: {
        in: [...completableCandidateSessionStatuses],
      },
    },
  });

  if (result.count > 0) {
    await updateCandidateInvitationStatusForSession({
      resumeToken,
      sessionId: input.sessionId,
      status: nextStatus,
    });
    return { ok: true as const, status: nextStatus };
  }

  const existingSession = await prisma.candidateSession.findFirst({
    select: { status: true },
    where: {
      id: input.sessionId,
      resumeToken,
    },
  });

  if (!existingSession) {
    return {
      ok: false as const,
      error: "candidate_session_not_found" as const,
      status: 404,
    };
  }

  const normalizedStatus = normalizeCandidateLifecycleStatus(
    existingSession.status,
  );
  if (normalizedStatus === "completed" || normalizedStatus === nextStatus) {
    return { ok: true as const, status: normalizedStatus };
  }

  return {
    ok: false as const,
    error: "candidate_session_not_mutable" as const,
    status: 409,
  };
}

export async function submitCandidateFormInterview(
  input: SubmitCandidateFormInterviewInput,
) {
  const prepared = await prepareCandidateSession({
    candidateEmail: input.candidateEmail,
    candidateName: input.candidateName,
    candidateToken: input.candidateToken,
    consentAccepted: input.consentAccepted,
    requestedModality: "form",
    resumeToken: input.resumeToken ?? undefined,
    videoEnabled: false,
  });

  if (!prepared.ok) {
    return prepared;
  }

  const answers = normalizeFormAnswers(input.answers);
  if (answers.length === 0) {
    if (prepared.productSession) {
      await markCandidateSessionLifecycle({
        action: "fail",
        resumeToken: prepared.resumeToken,
        sessionId: prepared.productSession.id,
      });
    }

    return {
      ok: false as const,
      error: "form_answers_missing" as const,
      status: 400,
    };
  }

  const now = new Date();
  const runtimeSessionId = `form_${prepared.productSession.id}`;

  await prisma.liveInterviewSession.upsert({
    create: {
      allowedModalities: ["form"],
      candidateId: prepared.productSession.id,
      createdAt: now,
      id: runtimeSessionId,
      interviewPlanId: prepared.interviewPlanId,
      livekitRoomName: `form-${prepared.productSession.id}`,
      status: "completed",
      updatedAt: now,
    },
    update: {
      allowedModalities: ["form"],
      candidateId: prepared.productSession.id,
      interviewPlanId: prepared.interviewPlanId,
      livekitRoomName: `form-${prepared.productSession.id}`,
      status: "completed",
      updatedAt: now,
    },
    where: { id: runtimeSessionId },
  });
  await prisma.liveInterviewEvent.deleteMany({
    where: { sessionId: runtimeSessionId },
  });
  await prisma.liveInterviewEvent.createMany({
    data: buildFormSubmissionEvents({
      answers,
      candidateSessionId: prepared.productSession.id,
      questions: prepared.productSession.interviewId
        ? await loadPublicQuestions(prepared.productSession.interviewId)
        : [],
      runtimeSessionId,
      startedAt: now,
    }),
  });
  await prisma.candidateSession.update({
    data: { realtimeSessionId: runtimeSessionId },
    where: { id: prepared.productSession.id },
  });
  const completion = await completeCandidateSession({
    resumeToken: prepared.resumeToken,
    sessionId: prepared.productSession.id,
  });
  if (!completion.ok) {
    return {
      ok: false as const,
      error: completion.error ?? "form_submission_unavailable",
      status: completion.status,
    };
  }

  if (prepared.supersededSessionId) {
    await prisma.candidateSession.update({
      data: { status: "superseded" },
      where: { id: prepared.supersededSessionId },
    });
  }

  return {
    ok: true as const,
    productSessionId: prepared.productSession.id,
    resumeToken: prepared.resumeToken,
    sessionId: runtimeSessionId,
  };
}

export function toProductCandidateLifecycleStatus(realtimeStatus: string) {
  return mapRealtimeStatusToCandidateLifecycleStatus(realtimeStatus);
}

async function notifyCandidateInterviewCompleted(candidateSessionId: string) {
  try {
    await notificationDispatcher.notifyCandidateInterviewCompleted({
      candidateSessionId,
    });
  } catch (error) {
    // Completion is already durable. An unavailable notification dependency must
    // never change the candidate-facing outcome.
    console.error("[notifications] completion dispatch failed", error);
  }
}

async function updateCandidateInvitationStatusForSession({
  resumeToken,
  sessionId,
  status,
}: {
  resumeToken: string;
  sessionId: string;
  status: "abandoned" | "completed" | "failed";
}) {
  const session = await prisma.candidateSession.findFirst({
    select: { candidateInvitationId: true },
    where: {
      id: sessionId,
      resumeToken,
    },
  });

  if (!session?.candidateInvitationId) {
    return;
  }

  await prisma.candidateInvitation.updateMany({
    data: { status },
    where: {
      id: session.candidateInvitationId,
      status: { notIn: ["expired", "superseded"] },
    },
  });
}

function toPublishedInterviewContext({
  interview,
  invitation,
}: {
  interview: {
    estimatedMinutes: number | null;
    id: string;
    job: { title: string };
    jobId: string;
    organization: { name: string };
    organizationId: string;
    publicToken: string;
    questions: unknown;
    responseModes: unknown;
    roleTitle: string;
  };
  invitation: PublicCandidateInvitation;
}): PublicInterviewContext {
  return {
    interview: {
      companyName: interview.organization.name,
      estimatedMinutes: interview.estimatedMinutes,
      id: interview.id,
      jobId: interview.jobId,
      jobTitle: interview.job.title,
      organizationId: interview.organizationId,
      publicToken: interview.publicToken,
      questions: resolvePublicQuestions(interview.questions),
      responseModes: resolvePublicResponseModes(interview.responseModes),
      roleTitle: interview.roleTitle,
    },
    invitation,
    kind: "published",
  };
}

function normalizeEmail(value?: string) {
  const trimmed = value?.trim().toLowerCase() ?? "";
  return trimmed.length > 3 ? trimmed : null;
}

function normalizeName(value?: string) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 1 ? trimmed : null;
}

function createResumeToken() {
  return `cs_${randomBytes(18).toString("base64url")}`;
}

function toCandidateStartError(
  reason: Exclude<
    ReturnType<typeof resolveCandidateStartPolicy>["reason"],
    null
  >,
): PrepareCandidateSessionError {
  if (reason === "completed") {
    return "candidate_session_already_completed";
  }

  if (reason === "expired") {
    return "candidate_session_expired";
  }

  if (reason === "superseded") {
    return "candidate_session_superseded";
  }

  return "candidate_session_not_resumable";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function resolvePublicResponseModes(value: unknown) {
  const modes = readStringArray(value).flatMap((mode) => {
    if (mode === "audio") {
      return ["audio"];
    }

    if (mode === "text" || mode === "form") {
      return ["form"];
    }

    return [];
  });

  return modes.length > 0 ? modes : ["audio"];
}

function normalizeFormAnswers(
  answers: SubmitCandidateFormInterviewInput["answers"],
) {
  return answers
    .map((answer) => ({
      questionId: answer.questionId.trim(),
      text: answer.text.trim(),
    }))
    .filter((answer) => answer.questionId && answer.text.length > 1);
}

async function loadPublicQuestions(interviewId: string) {
  const interview = await prisma.interview.findUnique({
    select: { questions: true },
    where: { id: interviewId },
  });

  return resolvePublicQuestions(interview?.questions);
}

function buildFormSubmissionEvents({
  answers,
  candidateSessionId,
  questions,
  runtimeSessionId,
  startedAt,
}: {
  answers: Array<{ questionId: string; text: string }>;
  candidateSessionId: string;
  questions: PublicInterviewQuestion[];
  runtimeSessionId: string;
  startedAt: Date;
}) {
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const events: Prisma.LiveInterviewEventCreateManyInput[] = [];
  const push = ({
    actor,
    offsetSeconds,
    payload,
    type,
  }: {
    actor: string;
    offsetSeconds: number;
    payload: Prisma.InputJsonObject;
    type: string;
  }) => {
    const sequenceNumber = events.length + 1;
    events.push({
      actor,
      candidateId: candidateSessionId,
      id: `evt_${runtimeSessionId}_${sequenceNumber}_${type}`,
      idempotencyKey: `${runtimeSessionId}:${sequenceNumber}:${type}`,
      occurredAt: addSeconds(startedAt, offsetSeconds),
      payload,
      providerMetadata: { source: "form_fallback" },
      sequenceNumber,
      sessionId: runtimeSessionId,
      type,
    });
  };

  push({
    actor: "system",
    offsetSeconds: 0,
    payload: { provider: "form_fallback" },
    type: "session_started",
  });
  push({
    actor: "candidate",
    offsetSeconds: 1,
    payload: { modes: ["form"] },
    type: "candidate_joined",
  });

  answers.forEach((answer, index) => {
    const question = questionById.get(answer.questionId);
    const prompt = question?.prompt ?? `Question ${index + 1}`;
    const baseOffset = 5 + index * 5;
    const interviewerTurnId = `turn_${answer.questionId}_form_prompt`;
    const candidateTurnId = `turn_${answer.questionId}_form_answer`;

    push({
      actor: "agent",
      offsetSeconds: baseOffset,
      payload: {
        prompt,
        questionId: answer.questionId,
        questionIndex: index,
        transcriptTurn: {
          endedAt: addSeconds(startedAt, baseOffset + 1).toISOString(),
          questionId: answer.questionId,
          sessionId: runtimeSessionId,
          speaker: "interviewer",
          startedAt: addSeconds(startedAt, baseOffset).toISOString(),
          text: prompt,
          turnId: interviewerTurnId,
        },
      },
      type: "question_asked",
    });
    push({
      actor: "candidate",
      offsetSeconds: baseOffset + 2,
      payload: {
        answerMode: "form",
        completionReason: "answered",
        questionId: answer.questionId,
        transcriptTurn: {
          endedAt: addSeconds(startedAt, baseOffset + 3).toISOString(),
          questionId: answer.questionId,
          sessionId: runtimeSessionId,
          speaker: "candidate",
          startedAt: addSeconds(startedAt, baseOffset + 2).toISOString(),
          text: answer.text,
          turnId: candidateTurnId,
        },
      },
      type: "candidate_turn_finalized",
    });
    push({
      actor: "agent",
      offsetSeconds: baseOffset + 4,
      payload: {
        completionReason: "answered",
        questionId: answer.questionId,
        source: "form_fallback",
      },
      type: "question_completed",
    });
  });

  push({
    actor: "system",
    offsetSeconds: 5 + answers.length * 5,
    payload: {
      completedQuestions: answers.length,
      completedReason: "form_fallback_submitted",
      totalQuestions: questions.length || answers.length,
    },
    type: "session_completed",
  });

  return events;
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function resolvePublicQuestions(value: unknown): PublicInterviewQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): PublicInterviewQuestion | null => {
      if (!isRecord(item)) {
        return null;
      }

      const prompt = readString(item.prompt).trim();
      if (!prompt) {
        return null;
      }

      const id = readString(item.id).trim() || `q_${index + 1}`;
      const signal = readString(item.signal).trim() || null;

      return { id, prompt, signal };
    })
    .filter((item): item is PublicInterviewQuestion => item !== null);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
