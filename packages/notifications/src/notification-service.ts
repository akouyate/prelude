import { createHash } from "node:crypto";
import { createElement } from "react";
import {
  candidateConsentCopyVersion,
  normalizeCandidateLifecycleStatus,
  resolveCandidateConsentGate,
} from "@prelude/core";
import { prisma } from "@prelude/db";

import {
  createNotificationEmailProviderFromEnv,
  NotificationProviderError,
  type NotificationEmailMessage,
  type NotificationEmailProvider,
} from "./email-provider";
import { readWorkspaceNotificationPreferences } from "./preferences";
import {
  CandidateInterviewCompletedEmail,
  RecruiterBriefNeedsAttentionEmail,
  RecruiterBriefReadyEmail,
} from "./templates";

export const notificationEventTypes = [
  "candidate_interview_completed",
  "candidate_brief_ready",
  "candidate_brief_needs_attention",
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

export type NotificationDispatchOutcome = {
  dedupeKey: string;
  status: "failed" | "in_progress" | "sent" | "skipped";
};

const retryWindowMs = 23 * 60 * 60 * 1000;
const staleClaimMs = 5 * 60 * 1000;
const recruiterRoles = ["owner", "admin", "recruiter"];

export function createNotificationDispatcher({
  now = () => new Date(),
  provider = createNotificationEmailProviderFromEnv(),
}: {
  now?: () => Date;
  provider?: NotificationEmailProvider;
} = {}) {
  return {
    notifyCandidateBrief: async ({
      candidateSessionId,
      status,
    }: {
      candidateSessionId: string;
      status: "completed" | "failed";
    }) => {
      const session = await prisma.candidateSession.findUnique({
        include: {
          candidateInvitation: {
            select: { candidateEmail: true, candidateName: true },
          },
          interview: { select: { roleTitle: true } },
          organization: {
            include: {
              memberships: {
                include: { user: { select: { email: true } } },
                where: {
                  role: { in: recruiterRoles },
                  status: "active",
                },
              },
            },
          },
        },
        where: { id: candidateSessionId },
      });

      if (!session) {
        return [] as NotificationDispatchOutcome[];
      }

      const preferences = readWorkspaceNotificationPreferences(
        session.organization.settings,
      );
      const candidateLabel =
        session.candidateName ??
        session.candidateEmail ??
        session.candidateInvitation?.candidateName ??
        session.candidateInvitation?.candidateEmail ??
        "Candidate";
      const eventType: NotificationEventType =
        status === "completed"
          ? "candidate_brief_ready"
          : "candidate_brief_needs_attention";
      const detailUrl = resolveCandidateDetailUrl(session.id);
      const recipients = uniqueEmails(
        session.organization.memberships.map(
          (membership) => membership.user.email,
        ),
      );

      return Promise.all(
        recipients.map((recipientEmail) =>
          dispatchDelivery({
            candidateSessionId: session.id,
            eventType,
            forceSkipReason: preferences.screensReadyForReview
              ? null
              : "review_notifications_disabled",
            message:
              status === "completed"
                ? {
                    react: createElement(RecruiterBriefReadyEmail, {
                      candidateLabel,
                      detailUrl,
                      roleTitle: session.interview.roleTitle,
                    }),
                    subject: `Screen ready: ${candidateLabel} · ${session.interview.roleTitle}`,
                    text: `${candidateLabel} completed the first screen for ${session.interview.roleTitle}. The recruiter brief is ready for human review: ${detailUrl}`,
                  }
                : {
                    react: createElement(RecruiterBriefNeedsAttentionEmail, {
                      candidateLabel,
                      detailUrl,
                      roleTitle: session.interview.roleTitle,
                    }),
                    subject: `Screen needs attention: ${candidateLabel} · ${session.interview.roleTitle}`,
                    text: `Prelude could not prepare the recruiter brief for ${candidateLabel}'s ${session.interview.roleTitle} screen. Review or retry it here: ${detailUrl}`,
                  },
            organizationId: session.organizationId,
            provider,
            recipientEmail,
            now,
          }),
        ),
      );
    },
    notifyCandidateInterviewCompleted: async ({
      candidateSessionId,
    }: {
      candidateSessionId: string;
    }) => {
      const session = await prisma.candidateSession.findUnique({
        include: {
          candidateInvitation: { select: { candidateEmail: true } },
          interview: { select: { roleTitle: true } },
          organization: { select: { name: true, settings: true } },
        },
        where: { id: candidateSessionId },
      });

      if (
        !session ||
        normalizeCandidateLifecycleStatus(session.status) !== "completed"
      ) {
        return null;
      }

      const recipientEmail = normalizeEmail(
        session.candidateEmail ?? session.candidateInvitation?.candidateEmail,
      );
      if (!recipientEmail) {
        return null;
      }

      const preferences = readWorkspaceNotificationPreferences(
        session.organization.settings,
      );
      const consent = resolveCandidateConsentGate({
        consentCopyVersion: session.consentCopyVersion,
        consentedAt: session.consentedAt,
        requiredConsentCopyVersion: candidateConsentCopyVersion,
      });

      return dispatchDelivery({
        candidateSessionId: session.id,
        eventType: "candidate_interview_completed",
        forceSkipReason: !preferences.candidateCompletionConfirmation
          ? "candidate_confirmation_disabled"
          : !consent.accepted
            ? "candidate_consent_not_current"
            : null,
        message: {
          react: createElement(CandidateInterviewCompletedEmail, {
            companyName: session.organization.name,
            roleTitle: session.interview.roleTitle,
          }),
          subject: `Your ${session.interview.roleTitle} interview is complete`,
          text: `Thank you for completing the ${session.interview.roleTitle} interview with ${session.organization.name}. A recruiter will review the conversation and follow up about next steps. Prelude does not make hiring decisions.`,
        },
        organizationId: session.organizationId,
        provider,
        recipientEmail,
        now,
      });
    },
  };
}

async function dispatchDelivery({
  candidateSessionId,
  eventType,
  forceSkipReason,
  message,
  now,
  organizationId,
  provider,
  recipientEmail,
}: {
  candidateSessionId: string;
  eventType: NotificationEventType;
  forceSkipReason: string | null;
  message: Pick<NotificationEmailMessage, "react" | "subject" | "text">;
  now: () => Date;
  organizationId: string;
  provider: NotificationEmailProvider;
  recipientEmail: string;
}): Promise<NotificationDispatchOutcome> {
  const dedupeKey = createDedupeKey({
    candidateSessionId,
    eventType,
    recipientEmail,
  });
  const currentTime = now();
  const delivery = await prisma.notificationDelivery.upsert({
    create: {
      candidateSessionId,
      dedupeKey,
      eventType,
      organizationId,
      recipientEmail,
    },
    update: {},
    where: { dedupeKey },
  });

  if (delivery.status === "sent" || delivery.status === "skipped") {
    return { dedupeKey, status: delivery.status };
  }

  if (
    delivery.status === "failed" &&
    delivery.attemptedAt &&
    currentTime.getTime() - delivery.attemptedAt.getTime() > retryWindowMs
  ) {
    return { dedupeKey, status: "failed" };
  }

  const claimed = await prisma.notificationDelivery.updateMany({
    data: {
      attemptCount: { increment: 1 },
      attemptedAt: currentTime,
      errorCode: null,
      errorSummary: null,
      status: "sending",
    },
    where: {
      id: delivery.id,
      OR: [
        { status: { in: ["pending", "failed"] } },
        {
          attemptedAt: { lt: new Date(currentTime.getTime() - staleClaimMs) },
          status: "sending",
        },
      ],
    },
  });

  if (claimed.count === 0) {
    return { dedupeKey, status: "in_progress" };
  }

  const claimedDelivery = await prisma.notificationDelivery.findUniqueOrThrow({
    select: { attemptCount: true, id: true },
    where: { id: delivery.id },
  });
  const attempt = {
    attemptNumber: claimedDelivery.attemptCount,
    createdAt: currentTime,
    notificationId: claimedDelivery.id,
  };

  if (forceSkipReason) {
    await persistSkippedAttempt({
      attempt,
      provider: "policy",
      reason: forceSkipReason,
    });
    return { dedupeKey, status: "skipped" };
  }

  try {
    const result = await provider.send({
      ...message,
      idempotencyKey: dedupeKey,
      tags: [
        { name: "prelude-event", value: eventType },
        { name: "prelude-delivery", value: delivery.id },
      ],
      to: recipientEmail,
    });

    if (result.status === "skipped") {
      await persistSkippedAttempt({
        attempt,
        provider: provider.name,
        reason: result.reason,
      });
      return { dedupeKey, status: "skipped" };
    }

    await prisma.$transaction([
      prisma.notificationDelivery.update({
        data: {
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          sentAt: currentTime,
          status: "sent",
        },
        where: { id: delivery.id },
      }),
      prisma.notificationAttempt.create({
        data: {
          ...attempt,
          provider: provider.name,
          providerMessageId: result.providerMessageId,
          status: "sent",
        },
      }),
    ]);
    return { dedupeKey, status: "sent" };
  } catch (error) {
    const providerError = summarizeProviderError(error);
    await prisma.$transaction([
      prisma.notificationDelivery.update({
        data: {
          errorCode: providerError.code,
          errorSummary: providerError.summary,
          failedAt: currentTime,
          provider: provider.name,
          status: "failed",
        },
        where: { id: delivery.id },
      }),
      prisma.notificationAttempt.create({
        data: {
          ...attempt,
          errorCode: providerError.code,
          errorSummary: providerError.summary,
          provider: provider.name,
          status: "failed",
        },
      }),
    ]);
    return { dedupeKey, status: "failed" };
  }
}

async function persistSkippedAttempt({
  attempt,
  provider,
  reason,
}: {
  attempt: {
    attemptNumber: number;
    createdAt: Date;
    notificationId: string;
  };
  provider: string;
  reason: string;
}) {
  await prisma.$transaction([
    prisma.notificationDelivery.update({
      data: {
        errorCode: reason,
        errorSummary: "Notification delivery was intentionally skipped.",
        provider,
        skippedAt: attempt.createdAt,
        status: "skipped",
      },
      where: { id: attempt.notificationId },
    }),
    prisma.notificationAttempt.create({
      data: {
        ...attempt,
        errorCode: reason,
        errorSummary: "Notification delivery was intentionally skipped.",
        provider,
        status: "skipped",
      },
    }),
  ]);
}

function createDedupeKey({
  candidateSessionId,
  eventType,
  recipientEmail,
}: {
  candidateSessionId: string;
  eventType: NotificationEventType;
  recipientEmail: string;
}) {
  const recipientHash = createHash("sha256")
    .update(recipientEmail)
    .digest("base64url");
  return `v1:${eventType}:${candidateSessionId}:${recipientHash}`;
}

function resolveCandidateDetailUrl(candidateSessionId: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_CONSOLE_URL?.trim().replace(/\/$/u, "") ||
    "http://localhost:3000";
  return `${baseUrl}/interviews/${candidateSessionId}`;
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : null;
}

function uniqueEmails(values: string[]) {
  return [
    ...new Set(
      values
        .map(normalizeEmail)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function summarizeProviderError(error: unknown) {
  if (error instanceof NotificationProviderError) {
    return {
      code: error.code.slice(0, 80),
      summary: "The email provider could not send this notification.",
    };
  }

  return {
    code: "provider_error",
    summary: "The email provider could not send this notification.",
  };
}
