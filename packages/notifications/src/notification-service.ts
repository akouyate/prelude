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
import { coerceNotificationLocale, type NotificationLocale } from "./locale";
import { readWorkspaceNotificationPreferences } from "./preferences";
import {
  CandidateInterviewCompletedEmail,
  CreditDisputeFrozenEmail,
  RecruiterBriefNeedsAttentionEmail,
  RecruiterBriefReadyEmail,
} from "./templates";

export const notificationEventTypes = [
  "candidate_interview_completed",
  "candidate_brief_ready",
  "candidate_brief_needs_attention",
  "credit_dispute_frozen",
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

export type NotificationDispatchOutcome = {
  dedupeKey: string;
  status: "failed" | "in_progress" | "sent" | "skipped";
};

const retryWindowMs = 23 * 60 * 60 * 1000;
const staleClaimMs = 5 * 60 * 1000;
const recruiterRoles = ["owner", "admin", "recruiter"];
// A frozen wallet is a money problem, not a hiring one: it goes to the people who
// can act on the bank dispute, not to every recruiter in the workspace.
const billingRoles = ["owner", "admin"];

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
                include: {
                  user: { select: { email: true, preferredLanguage: true } },
                },
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
      const recipients = uniqueLocalizedRecipients(
        session.organization.memberships.map((membership) => membership.user),
      );

      return Promise.all(
        recipients.map(({ email: recipientEmail, locale }) =>
          dispatchDelivery({
            candidateSessionId: session.id,
            dedupeSubject: session.id,
            eventType,
            forceSkipReason: preferences.screensReadyForReview
              ? null
              : "review_notifications_disabled",
            locale,
            message:
              status === "completed"
                ? {
                    react: createElement(RecruiterBriefReadyEmail, {
                      candidateLabel,
                      detailUrl,
                      locale,
                      roleTitle: session.interview.roleTitle,
                    }),
                    subject: `Screen ready: ${candidateLabel} · ${session.interview.roleTitle}`,
                    text: `${candidateLabel} completed the first screen for ${session.interview.roleTitle}. The recruiter brief is ready for human review: ${detailUrl}`,
                  }
                : {
                    react: createElement(RecruiterBriefNeedsAttentionEmail, {
                      candidateLabel,
                      detailUrl,
                      locale,
                      roleTitle: session.interview.roleTitle,
                    }),
                    subject: `Screen needs attention: ${candidateLabel} · ${session.interview.roleTitle}`,
                    text: `HireCall could not prepare the recruiter brief for ${candidateLabel}'s ${session.interview.roleTitle} screen. Review or retry it here: ${detailUrl}`,
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
        dedupeSubject: session.id,
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
          text: `Thank you for completing the ${session.interview.roleTitle} interview with ${session.organization.name}. A recruiter will review the conversation and follow up about next steps. HireCall does not make hiring decisions.`,
        },
        organizationId: session.organizationId,
        provider,
        recipientEmail,
        now,
      });
    },
    /**
     * Amendment 16 of the prepaid-credit plan: `charge.dispute.created` freezes
     * the disputed lot immediately, and the workspace has to be told. The
     * alternative — a recruiter discovering the block when a candidate cannot
     * start — is the churn scenario this exists to prevent.
     *
     * Workspace-scoped, so it is the one delivery with no candidate session
     * behind it (`NotificationDelivery.candidateSessionId` is nullable), and the
     * only one with no preference gate: this is an operational notice about the
     * customer's money, not a hiring digest anyone can opt out of.
     *
     * The dedupe key is the STRIPE EVENT id, so a replayed `charge.dispute.created`
     * sends nothing new — which matters, because the ledger freeze it accompanies
     * is idempotent too.
     */
    notifyCreditDisputeFrozen: async ({
      frozenCredits,
      organizationId,
      stripeEventId,
    }: {
      frozenCredits: number;
      organizationId: string;
      stripeEventId: string;
    }) => {
      const organization = await prisma.organization.findUnique({
        include: {
          memberships: {
            include: {
              user: { select: { email: true, preferredLanguage: true } },
            },
            where: { role: { in: billingRoles }, status: "active" },
          },
        },
        where: { id: organizationId },
      });

      if (!organization) {
        return [] as NotificationDispatchOutcome[];
      }

      const billingUrl = resolveBillingSettingsUrl();
      const recipients = uniqueLocalizedRecipients(
        organization.memberships.map((membership) => membership.user),
      );
      const creditLabel = frozenCredits === 1 ? "credit" : "credits";

      return Promise.all(
        recipients.map(({ email: recipientEmail, locale }) =>
          dispatchDelivery({
            candidateSessionId: null,
            dedupeSubject: stripeEventId,
            eventType: "credit_dispute_frozen",
            forceSkipReason: null,
            locale,
            message: {
              react: createElement(CreditDisputeFrozenEmail, {
                billingUrl,
                frozenCredits,
                locale,
              }),
              subject: `Action needed: a bank dispute has frozen ${frozenCredits} interview ${creditLabel}`,
              text: `A bank dispute was opened on one of your HireCall credit purchases, so ${frozenCredits} interview ${creditLabel} ${frozenCredits === 1 ? "is" : "are"} temporarily blocked while it is resolved. Interviews already under way are not interrupted, and the credits are released in full if the dispute is resolved in your favour. Billing settings: ${billingUrl}`,
            },
            organizationId,
            provider,
            recipientEmail,
            now,
          }),
        ),
      );
    },
  };
}

async function dispatchDelivery({
  candidateSessionId,
  dedupeSubject,
  eventType,
  forceSkipReason,
  locale = null,
  message,
  now,
  organizationId,
  provider,
  recipientEmail,
}: {
  candidateSessionId: string | null;
  /**
   * What "the same notification" is scoped to — the candidate session for
   * candidate-shaped events, the Stripe event id for a workspace-level one.
   * Split from `candidateSessionId` so a delivery with no session still gets a
   * stable key; for the candidate events the two are the same value, so no
   * existing `dedupeKey` changes.
   */
  dedupeSubject: string;
  eventType: NotificationEventType;
  forceSkipReason: string | null;
  /**
   * The recipient's resolved locale, recorded for audit alongside
   * `User.preferredLanguage`. Only the notifications this task threads a
   * locale through pass one; every other caller leaves it null rather than
   * fabricating a value (see `notifyCandidateInterviewCompleted`, whose
   * locale follows the interview, not the workspace).
   */
  locale?: NotificationLocale | null;
  message: Pick<NotificationEmailMessage, "react" | "subject" | "text">;
  now: () => Date;
  organizationId: string;
  provider: NotificationEmailProvider;
  recipientEmail: string;
}): Promise<NotificationDispatchOutcome> {
  const dedupeKey = createDedupeKey({
    dedupeSubject,
    eventType,
    recipientEmail,
  });
  const currentTime = now();
  const delivery = await prisma.notificationDelivery.upsert({
    create: {
      candidateSessionId,
      dedupeKey,
      eventType,
      locale,
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
  dedupeSubject,
  eventType,
  recipientEmail,
}: {
  dedupeSubject: string;
  eventType: NotificationEventType;
  recipientEmail: string;
}) {
  const recipientHash = createHash("sha256")
    .update(recipientEmail)
    .digest("base64url");
  return `v1:${eventType}:${dedupeSubject}:${recipientHash}`;
}

function resolveCandidateDetailUrl(candidateSessionId: string) {
  return `${resolveConsoleBaseUrl()}/interviews/${candidateSessionId}`;
}

function resolveBillingSettingsUrl() {
  // `?view=billing` is load-bearing, not decoration: the settings page selects its
  // panel from that query param (`useQueryState("view", …)` in
  // `workspace-settings.tsx`), so a bare `/settings` lands the recipient on the
  // default panel with no credit balance in sight — after an email that just told
  // them their credits are blocked. Every other billing path carries it.
  return `${resolveConsoleBaseUrl()}/settings?view=billing`;
}

function resolveConsoleBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_CONSOLE_URL?.trim().replace(/\/$/u, "") ||
    "http://localhost:3000"
  );
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : null;
}

/**
 * Dedupes recipients by normalized email (a user can hold more than one
 * active membership) while coercing each one's own `preferredLanguage` — the
 * per-recipient locale a fan-out notification needs, not the workspace's.
 */
function uniqueLocalizedRecipients(
  users: { email: string; preferredLanguage: string | null | undefined }[],
): { email: string; locale: NotificationLocale }[] {
  const localeByEmail = new Map<string, NotificationLocale>();

  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (!email || localeByEmail.has(email)) {
      continue;
    }
    localeByEmail.set(email, coerceNotificationLocale(user.preferredLanguage));
  }

  return [...localeByEmail.entries()].map(([email, locale]) => ({
    email,
    locale,
  }));
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
