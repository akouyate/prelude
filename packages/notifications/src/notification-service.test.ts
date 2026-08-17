import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  ),
  candidateSession: {
    findUnique: vi.fn(),
  },
  organization: {
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
    prismaMock.organization.findUnique.mockResolvedValue({
      id: "org_123",
      memberships: [{ user: { email: "owner@example.com" } }],
      name: "Acme Talent",
    });
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

  // Candidate language follows the interview, never the workspace, so this
  // notification's locale resolution stays out of scope here — the delivery
  // row records no locale rather than fabricating one.
  it("leaves the candidate confirmation's delivery locale null", async () => {
    const provider = fakeProvider();
    provider.send.mockResolvedValue({
      providerMessageId: "email_123",
      status: "sent",
    });

    await createNotificationDispatcher({
      now: () => now,
      provider,
    }).notifyCandidateInterviewCompleted({ candidateSessionId: "cs_123" });

    expect(prismaMock.notificationDelivery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ locale: null }),
      }),
    );
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

  it("records each recruiter recipient's own coerced locale on the brief delivery", async () => {
    prismaMock.candidateSession.findUnique.mockResolvedValue({
      ...completedSession(),
      organization: {
        memberships: [
          { user: { email: "owner@example.com", preferredLanguage: "fr" } },
          {
            user: { email: "recruiter@example.com", preferredLanguage: "de" },
          },
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

    await createNotificationDispatcher({
      provider,
    }).notifyCandidateBrief({
      candidateSessionId: "cs_123",
      status: "completed",
    });

    expect(prismaMock.notificationDelivery.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          locale: "fr",
          recipientEmail: "owner@example.com",
        }),
      }),
    );
    // "de" is not a supported console locale, so it coerces to "en" — the
    // same rule apps/console/src/libs/i18n-server.ts applies.
    expect(prismaMock.notificationDelivery.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          locale: "en",
          recipientEmail: "recruiter@example.com",
        }),
      }),
    );
  });

  /**
   * Amendment 16 of the prepaid-credit plan: a bank dispute freezes credits
   * immediately, and a workspace that discovers the block through its candidates
   * is the churn scenario. This notice is workspace-scoped, not candidate-scoped,
   * which is why it is the one delivery with no candidate session behind it.
   */
  describe("credit dispute freeze", () => {
    it("tells the workspace how many credits a dispute just blocked", async () => {
      const provider = fakeProvider();
      provider.send.mockResolvedValue({
        providerMessageId: "email_dispute",
        status: "sent",
      });

      const outcomes = await createNotificationDispatcher({
        now: () => now,
        provider,
      }).notifyCreditDisputeFrozen({
        frozenCredits: 24,
        organizationId: "org_123",
        stripeEventId: "evt_dispute_1",
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ status: "sent" });
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Action needed: a bank dispute has frozen 24 interview credits",
          to: "owner@example.com",
        }),
      );
      // No candidate session behind it — the column is nullable precisely so a
      // workspace-level delivery does not have to invent one.
      expect(prismaMock.notificationDelivery.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            candidateSessionId: null,
            eventType: "credit_dispute_frozen",
            organizationId: "org_123",
          }),
        }),
      );
    });

    it("keys the dedupe on the Stripe event, so a replay sends nothing new", async () => {
      const provider = fakeProvider();
      provider.send.mockResolvedValue({
        providerMessageId: "email_dispute",
        status: "sent",
      });

      await createNotificationDispatcher({ provider }).notifyCreditDisputeFrozen({
        frozenCredits: 24,
        organizationId: "org_123",
        stripeEventId: "evt_dispute_1",
      });

      const key = prismaMock.notificationDelivery.upsert.mock.calls[0]?.[0].where
        .dedupeKey as string;
      expect(key).toContain("credit_dispute_frozen");
      expect(key).toContain("evt_dispute_1");
    });

    it("records each billing recipient's own coerced locale on the freeze delivery", async () => {
      prismaMock.organization.findUnique.mockResolvedValue({
        id: "org_123",
        memberships: [
          { user: { email: "owner@example.com", preferredLanguage: "fr" } },
          { user: { email: "admin@example.com", preferredLanguage: null } },
        ],
        name: "Acme Talent",
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
        providerMessageId: "email_dispute",
        status: "sent",
      });

      await createNotificationDispatcher({
        now: () => now,
        provider,
      }).notifyCreditDisputeFrozen({
        frozenCredits: 24,
        organizationId: "org_123",
        stripeEventId: "evt_dispute_1",
      });

      expect(prismaMock.notificationDelivery.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          create: expect.objectContaining({
            locale: "fr",
            recipientEmail: "owner@example.com",
          }),
        }),
      );
      // A missing preferredLanguage coerces to "en" rather than staying null —
      // only the untouched candidate notification records a null locale.
      expect(prismaMock.notificationDelivery.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          create: expect.objectContaining({
            locale: "en",
            recipientEmail: "admin@example.com",
          }),
        }),
      );
    });

    it("stays silent, and does not throw, for a workspace it cannot find", async () => {
      prismaMock.organization.findUnique.mockResolvedValue(null);
      const provider = fakeProvider();

      const outcomes = await createNotificationDispatcher({
        provider,
      }).notifyCreditDisputeFrozen({
        frozenCredits: 24,
        organizationId: "org_missing",
        stripeEventId: "evt_dispute_1",
      });

      expect(outcomes).toEqual([]);
      expect(provider.send).not.toHaveBeenCalled();
    });
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
