import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  ),
  candidateSession: {
    findUnique: vi.fn(),
  },
  notificationAttempt: {
    create: vi.fn(),
  },
  notificationDelivery: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));

import {
  createNotificationDispatcher,
  NotificationProviderError,
  type NotificationEmailProvider,
} from "./index";

const now = new Date("2026-07-17T10:00:00.000Z");

describe("notification dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notificationDelivery.update.mockResolvedValue({});
    prismaMock.notificationAttempt.create.mockResolvedValue({});
    prismaMock.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notificationDelivery.findUniqueOrThrow.mockResolvedValue({
      attemptCount: 1,
      id: "delivery_123",
    });
    prismaMock.notificationDelivery.upsert.mockResolvedValue({
      attemptedAt: null,
      id: "delivery_123",
      status: "pending",
    });
    prismaMock.candidateSession.findUnique.mockResolvedValue(
      completedSession(),
    );
  });

  it("sends exactly one consented candidate confirmation and persists its attempt", async () => {
    const provider = fakeProvider();
    provider.send.mockResolvedValue({
      providerMessageId: "email_123",
      status: "sent",
    });

    const outcome = await createNotificationDispatcher({
      now: () => now,
      provider,
    }).notifyCandidateInterviewCompleted({ candidateSessionId: "cs_123" });

    expect(outcome).toMatchObject({ status: "sent" });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Customer Success Manager interview is complete",
        to: "candidate@example.com",
      }),
    );
    expect(prismaMock.notificationAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: "resend",
        providerMessageId: "email_123",
        status: "sent",
      }),
    });
  });

  it("does not resend a terminal delivery", async () => {
    prismaMock.notificationDelivery.upsert.mockResolvedValue({
      attemptedAt: now,
      id: "delivery_123",
      status: "sent",
    });
    const provider = fakeProvider();

    const outcome = await createNotificationDispatcher({
      provider,
    }).notifyCandidateInterviewCompleted({ candidateSessionId: "cs_123" });

    expect(outcome).toMatchObject({ status: "sent" });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("persists a skip when the workspace has disabled candidate confirmation", async () => {
    prismaMock.candidateSession.findUnique.mockResolvedValue(
      completedSession({
        organization: {
          name: "Acme Talent",
          settings: {
            notifications: { candidateCompletionConfirmation: false },
          },
        },
      }),
    );
    const provider = fakeProvider();

    const outcome = await createNotificationDispatcher({
      provider,
    }).notifyCandidateInterviewCompleted({ candidateSessionId: "cs_123" });

    expect(outcome).toMatchObject({ status: "skipped" });
    expect(provider.send).not.toHaveBeenCalled();
    expect(prismaMock.notificationAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorCode: "candidate_confirmation_disabled",
        provider: "policy",
        status: "skipped",
      }),
    });
  });

  it("persists a provider failure without throwing into the product workflow", async () => {
    const provider = fakeProvider();
    provider.send.mockRejectedValue(
      new NotificationProviderError("rate_limit", "provider response redacted"),
    );

    const outcome = await createNotificationDispatcher({
      provider,
    }).notifyCandidateInterviewCompleted({ candidateSessionId: "cs_123" });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(prismaMock.notificationAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorCode: "rate_limit",
        errorSummary: "The email provider could not send this notification.",
        status: "failed",
      }),
    });
  });

  it("targets only active recruiter-facing workspace roles for a ready brief", async () => {
    prismaMock.candidateSession.findUnique.mockResolvedValue({
      ...completedSession(),
      organization: {
        memberships: [
          { user: { email: "owner@example.com" } },
          { user: { email: "recruiter@example.com" } },
        ],
        name: "Acme Talent",
        settings: { notifications: { screensReadyForReview: true } },
      },
    });
    prismaMock.notificationDelivery.upsert
      .mockResolvedValueOnce({
        attemptedAt: null,
        id: "delivery_1",
        status: "pending",
      })
      .mockResolvedValueOnce({
        attemptedAt: null,
        id: "delivery_2",
        status: "pending",
      });
    prismaMock.notificationDelivery.findUniqueOrThrow
      .mockResolvedValueOnce({ attemptCount: 1, id: "delivery_1" })
      .mockResolvedValueOnce({ attemptCount: 1, id: "delivery_2" });
    const provider = fakeProvider();
    provider.send.mockResolvedValue({
      providerMessageId: "email_123",
      status: "sent",
    });

    const outcomes = await createNotificationDispatcher({
      provider,
    }).notifyCandidateBrief({
      candidateSessionId: "cs_123",
      status: "completed",
    });

    expect(outcomes).toHaveLength(2);
    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(provider.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: "owner@example.com" }),
    );
    expect(provider.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: "recruiter@example.com" }),
    );
  });
});

function completedSession(overrides: Record<string, unknown> = {}) {
  return {
    candidateEmail: "candidate@example.com",
    candidateInvitation: { candidateEmail: null, candidateName: null },
    candidateName: "Ada Martin",
    consentCopyVersion: "candidate-consent-v2",
    consentedAt: now,
    id: "cs_123",
    interview: { roleTitle: "Customer Success Manager" },
    organization: {
      memberships: [],
      name: "Acme Talent",
      settings: { notifications: {} },
    },
    organizationId: "org_123",
    status: "completed",
    ...overrides,
  };
}

function fakeProvider() {
  return {
    name: "resend",
    send: vi.fn(),
  } as unknown as NotificationEmailProvider & {
    send: ReturnType<typeof vi.fn>;
  };
}
