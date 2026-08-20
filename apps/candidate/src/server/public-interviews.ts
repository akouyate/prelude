import { randomBytes } from "node:crypto";

import {
  candidateConsentCopyFor,
  mapRealtimeStatusToCandidateLifecycleStatus,
  normalizeCandidateLifecycleStatus,
  resolveCandidateStartPolicy,
} from "@prelude/core";
import { prisma } from "@prelude/db";
import { createNotificationDispatcher } from "@prelude/notifications";
import type {
  MarketingDemoPostInterviewQuestion,
  WorkspaceLanguage,
} from "@prelude/contracts";
import type { Prisma } from "@prelude/db";

import {
  createEntitledCandidateSession,
  resumeEntitledCandidateSession,
} from "./billing-admission";
import { settleCandidateSessionCredit } from "./credit-settlement";
import { resolveCandidateRenderingLanguage } from "./interview-language";
import { isRecordingActive } from "./recording-state";

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
        // Already resolved by `resolveCandidateRenderingLanguage`, never the raw
        // column: one server-side resolution feeds both the rendered copy and
        // the recorded `consentLanguage`.
        language: WorkspaceLanguage;
        organizationId: string;
        publicToken: string;
        questions: PublicInterviewQuestion[];
        // Resolved once here, exactly like `language`, from the deployment's
        // `RECORDING_ENABLED`. It picks which v3 consent variant the pre-join
        // screens render AND which version id is stamped on the session, so the
        // copy the candidate read and the record of what they agreed to are one
        // resolution, never two.
        recordingActive: boolean;
        responseModes: string[];
        roleTitle: string;
      };
    }
  | {
      kind: "preview";
      expiresAt: Date;
      previewVariant: "recruiter_preview" | "marketing_demo";
      returnPath: string;
      marketingDemo: {
        postInterviewQuestions: MarketingDemoPostInterviewQuestion[];
        returnTarget: string;
        roleSlug: string;
        roleVersion: number;
      } | null;
      interview: {
        companyName: string;
        estimatedMinutes: number | null;
        id: string;
        jobId: string;
        jobTitle: string;
        language: WorkspaceLanguage;
        organizationId: string;
        publicToken: string;
        questions: PublicInterviewQuestion[];
        // Always false for a preview: a recruiter preview starts no egress
        // whatever the deployment flag says, so it must show the no-recording
        // truth.
        recordingActive: boolean;
        responseModes: string[];
        roleTitle: string;
      };
    }
  | {
      kind: "not_found";
      previewVariant?: "marketing_demo";
    };

export type PublicInterviewContextOptions = {
  /**
   * Whether resolving the token may also write what the visit implies: the lazy
   * expiry flip, and the `openedAt` stamp that moves an invitation from
   * `invited` to `opened`.
   *
   * The interview page leaves this on — reaching that URL IS the candidate
   * opening their interview, and `opened` is exactly what the recruiter reads
   * in the invitations panel. `/interview/<token>/privacy` passes `false`: it
   * is a second URL on the same token, and a more casually fetched one (email
   * scanners, link-preview bots), so resolving it stays a pure read rather than
   * manufacturing a "the candidate opened it" signal nobody earned.
   */
  recordVisit?: boolean;
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
  | "billing_unavailable"
  | "candidate_session_already_completed"
  | "candidate_session_expired"
  | "candidate_interview_limit_reached"
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
  options: PublicInterviewContextOptions = {},
): Promise<PublicInterviewContext> {
  const recordVisit = options.recordVisit ?? true;
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
    // The read below returns the same context either way — the `expired` status
    // it reports is derived from `expiresAt`, not from the write. So skipping
    // the writes costs the caller nothing but the side effect.
    if (recordVisit) {
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

  if (context.kind !== "published") {
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

  // One resolution, three writes — for both facts that decide what the candidate
  // was shown. `context.interview.language` is what the welcome and preflight
  // screens rendered this request in, and `context.interview.recordingActive` is
  // the recording reality those same screens described. Stamping the version the
  // SELECTOR returned for that pair records the copy the candidate actually
  // read, never a version re-derived after the fact.
  const consentLanguage = context.interview.language;
  const consentCopy = candidateConsentCopyFor(
    consentLanguage,
    context.interview.recordingActive,
  );
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
  const sessionResult = shouldResumeExisting
    ? await resumeEntitledCandidateSession({
        data: {
          candidateEmail,
          candidateName,
          candidateInvitationId: context.invitation?.id,
          consentCopyVersion: consentCopy.version,
          consentLanguage,
          // Resuming requires accepting the current consent copy again.
          consentedAt: now,
          startedAt: existingSession.startedAt ?? now,
          status: "starting",
        },
        now,
        // The session row owns the organization it was admitted under; the
        // interview is only how the candidate reached it.
        organizationId: existingSession.organizationId,
        sessionId: existingSession.id,
      })
    : await createEntitledCandidateSession({
        data: {
          candidateEmail,
          candidateName,
          candidateInvitationId: context.invitation?.id,
          consentCopyVersion: consentCopy.version,
          consentLanguage,
          consentedAt: now,
          interviewId: context.interview.id,
          jobId: context.interview.jobId,
          organizationId: context.interview.organizationId,
          resumeToken: createResumeToken(),
          startedAt: now,
          status: "starting",
        },
        now,
        organizationId: context.interview.organizationId,
      });
  if (!sessionResult.ok) {
    return {
      ok: false as const,
      error: sessionResult.error,
      status: 402,
    };
  }
  const productSession = sessionResult.session;

  if (context.invitation) {
    await prisma.candidateInvitation.updateMany({
      data: {
        candidateEmail,
        candidateName,
        consentCopyVersion: consentCopy.version,
        consentLanguage,
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

  const now = new Date();
  const result = await prisma.candidateSession.updateMany({
    data: {
      completedAt: now,
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
    await settleCandidateSessionCredit(prisma, {
      kind: "completed",
      now,
      sessionId: input.sessionId,
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
    // Settling again on this replay is how a completion whose first settlement
    // failed still gets charged: capture reports `already_captured` when it
    // succeeded, and retakes the decision when it never ran.
    await settleCandidateSessionCredit(prisma, {
      kind: "completed",
      now,
      sessionId: input.sessionId,
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

  const now = new Date();
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
    await settleCandidateSessionCredit(prisma, {
      kind: nextStatus,
      now,
      sessionId: input.sessionId,
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
  if (normalizedStatus === nextStatus) {
    // Same replay recovery as the completion path. A session already marked
    // `completed` is deliberately excluded: completion owns its own settlement,
    // and a release issued here could land ahead of a capture still in flight
    // and hand back a credit the interview earned.
    await settleCandidateSessionCredit(prisma, {
      kind: nextStatus,
      now,
      sessionId: input.sessionId,
    });
    return { ok: true as const, status: normalizedStatus };
  }

  if (normalizedStatus === "completed") {
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
    await settleCandidateSessionCredit(prisma, {
      kind: "superseded",
      now,
      sessionId: prepared.supersededSessionId,
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
    language: string | null;
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
      language: resolveCandidateRenderingLanguage(interview.language),
      organizationId: interview.organizationId,
      publicToken: interview.publicToken,
      questions: resolvePublicQuestions(interview.questions),
      recordingActive: isRecordingActive(),
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
