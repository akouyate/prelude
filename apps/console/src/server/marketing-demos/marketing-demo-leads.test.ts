import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const transaction = {
    marketingDemoControl: { update: vi.fn() },
    marketingDemoDailyUsage: { update: vi.fn(), upsert: vi.fn() },
    marketingDemoLead: { updateMany: vi.fn(), upsert: vi.fn() },
    marketingDemoLeadCapture: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    marketingDemoLeadOutbox: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    marketingDemoLead: { deleteMany: vi.fn(), findMany: vi.fn() },
    marketingDemoLeadCapture: { deleteMany: vi.fn() },
    marketingDemoLeadOutbox: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return { prisma, transaction };
});

vi.mock("@prelude/db", () => ({ prisma: database.prisma }));

import {
  captureMarketingDemoLead,
  MarketingDemoLeadError,
  processMarketingDemoLeadOperations,
  sweepExpiredMarketingDemoLeads,
  withdrawMarketingDemoLead,
} from "./marketing-demo-leads";

const now = new Date("2026-08-21T10:00:00.000Z");
const captureToken = `mdlc_${"l".repeat(43)}`;
const webhookSecret = "w".repeat(32);
const unsubscribeSecret = "u".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  database.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof database.transaction) => unknown) =>
      callback(database.transaction),
  );
  database.transaction.marketingDemoLeadCapture.findMany.mockResolvedValue([]);
  database.transaction.marketingDemoControl.update.mockResolvedValue({
    dailyLeadCap: 100,
    enabled: true,
  });
  database.transaction.marketingDemoLeadCapture.findUnique.mockResolvedValue({
    expiresAt: new Date("2026-08-21T10:30:00.000Z"),
    roleSlug: "account-executive",
  });
  database.transaction.marketingDemoDailyUsage.upsert.mockResolvedValue({
    leadCount: 0,
  });
  database.transaction.marketingDemoLeadCapture.deleteMany.mockResolvedValue({
    count: 1,
  });
  database.transaction.marketingDemoLead.upsert.mockResolvedValue({
    id: "lead_1",
  });
  database.prisma.marketingDemoLead.findMany.mockResolvedValue([]);
  database.prisma.marketingDemoLeadOutbox.findFirst.mockResolvedValue(null);
  vi.stubEnv(
    "MARKETING_DEMO_LEAD_WEBHOOK_URL",
    "https://crm.example.test/leads",
  );
  vi.stubEnv("MARKETING_DEMO_LEAD_WEBHOOK_SECRET", webhookSecret);
  vi.stubEnv("MARKETING_DEMO_LEAD_UNSUBSCRIBE_SECRET", unsubscribeSecret);
  vi.stubEnv("NEXT_PUBLIC_CONSOLE_URL", "https://www.hirecall.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("captureMarketingDemoLead", () => {
  it("atomically consumes the proof and derives the role server-side", async () => {
    await expect(
      captureMarketingDemoLead(
        {
          captureToken,
          email: "  Buyer@Example.COM ",
          marketingConsent: true,
        },
        now,
      ),
    ).resolves.toEqual({ accepted: true });

    expect(
      database.transaction.marketingDemoLeadCapture.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        tokenDigest: createHash("sha256").update(captureToken).digest("hex"),
      },
    });
    expect(database.transaction.marketingDemoLead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          email: "buyer@example.com",
          marketingConsent: true,
          roleSlug: "account-executive",
        }),
      }),
    );
    expect(
      database.transaction.marketingDemoLeadOutbox.create,
    ).toHaveBeenCalled();
    expect(
      JSON.stringify(database.transaction.marketingDemoLead.upsert.mock.calls),
    ).not.toMatch(/transcript|answers/u);
  });

  it("rejects visitor-authored role data through the strict schema", async () => {
    await expect(
      captureMarketingDemoLead({
        captureToken,
        email: "buyer@example.com",
        marketingConsent: true,
        roleSlug: "visitor-controlled",
      }),
    ).rejects.toMatchObject({ code: "invalid_lead", status: 400 });

    expect(database.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a setup request without granting marketing consent", async () => {
    await captureMarketingDemoLead(
      {
        captureToken,
        email: "buyer@example.com",
        marketingConsent: false,
      },
      now,
    );

    expect(database.transaction.marketingDemoLead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          consentedAt: null,
          marketingConsent: false,
        }),
      }),
    );
    expect(
      database.transaction.marketingDemoLeadOutbox.create,
    ).toHaveBeenCalledTimes(1);
    expect(
      database.transaction.marketingDemoLeadOutbox.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "setup_requested" }),
      }),
    );
  });

  it("allows only one winner when two requests race on the same proof", async () => {
    database.transaction.marketingDemoLeadCapture.deleteMany.mockResolvedValueOnce(
      {
        count: 0,
      },
    );

    await expect(
      captureMarketingDemoLead(
        { captureToken, email: "buyer@example.com", marketingConsent: true },
        now,
      ),
    ).rejects.toMatchObject({ code: "lead_capture_not_found", status: 404 });
    expect(
      database.transaction.marketingDemoLead.upsert,
    ).not.toHaveBeenCalled();
  });

  it("checks the global daily cap before consuming the proof", async () => {
    database.transaction.marketingDemoDailyUsage.upsert.mockResolvedValueOnce({
      leadCount: 100,
    });

    await expect(
      captureMarketingDemoLead(
        { captureToken, email: "buyer@example.com", marketingConsent: true },
        now,
      ),
    ).rejects.toMatchObject({
      code: "lead_capture_rate_limited",
      status: 429,
    });
    expect(
      database.transaction.marketingDemoLeadCapture.deleteMany,
    ).not.toHaveBeenCalled();
  });

  it("fails closed when the controls cannot be read", async () => {
    database.transaction.marketingDemoControl.update.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      captureMarketingDemoLead(
        { captureToken, email: "buyer@example.com", marketingConsent: true },
        now,
      ),
    ).rejects.toMatchObject({
      code: "lead_capture_unavailable",
      status: 503,
    });
  });
});

describe("lead delivery and withdrawal", () => {
  it("sends only consent metadata with an idempotency key and supports withdrawal", async () => {
    const candidate = {
      attemptCount: 0,
      createdAt: now,
      eventType: "consent_granted",
      id: "outbox_1",
      lead: {
        consentVersion: "marketing-demo-email-v1",
        consentedAt: now,
        email: "buyer@example.com",
        id: "lead_1",
        marketingConsent: true,
        roleSlug: "account-executive",
        withdrawnAt: null,
      },
      nextAttemptAt: now,
    };
    database.prisma.marketingDemoLeadOutbox.findFirst
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(null);
    database.prisma.marketingDemoLeadOutbox.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      processMarketingDemoLeadOperations({ limit: 10, now, request }),
    ).resolves.toEqual({ delivered: 1, failed: 0, removed: 0 });

    const [, init] = request.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      email: "buyer@example.com",
      eventId: "outbox_1",
      eventType: "consent_granted",
      marketingConsent: true,
      roleSlug: "account-executive",
    });
    expect(JSON.stringify(body)).not.toMatch(/transcript|answers|candidate/u);
    expect(new Headers(init.headers).get("idempotency-key")).toBe("outbox_1");

    const unsubscribeUrl = new URL(String(body.unsubscribeUrl));
    database.transaction.marketingDemoLead.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    await expect(
      withdrawMarketingDemoLead(
        unsubscribeUrl.searchParams.get("token") ?? "",
        now,
      ),
    ).resolves.toEqual({ withdrawn: true });
    expect(
      database.transaction.marketingDemoLeadOutbox.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "cancelled" }),
      }),
    );
    expect(
      database.transaction.marketingDemoLeadOutbox.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "consent_withdrawn" }),
      }),
    );
  });

  it("requeues webhook failures without logging private response bodies", async () => {
    database.prisma.marketingDemoLeadOutbox.findFirst
      .mockResolvedValueOnce({
        attemptCount: 2,
        createdAt: now,
        eventType: "consent_granted",
        id: "outbox_2",
        lead: {
          consentVersion: "marketing-demo-email-v1",
          consentedAt: now,
          email: "buyer@example.com",
          id: "lead_1",
          marketingConsent: true,
          roleSlug: "account-executive",
          withdrawnAt: null,
        },
        nextAttemptAt: now,
      })
      .mockResolvedValueOnce(null);
    database.prisma.marketingDemoLeadOutbox.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    await expect(
      processMarketingDemoLeadOperations({
        limit: 1,
        now,
        request: vi
          .fn()
          .mockResolvedValue(new Response("private", { status: 500 })),
      }),
    ).resolves.toEqual({ delivered: 0, failed: 1, removed: 0 });
    expect(database.prisma.marketingDemoLeadOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: "http_500",
          status: "pending",
        }),
      }),
    );
  });
});

describe("lead retention", () => {
  it("deletes only selected expired leads and expired capture proofs", async () => {
    database.prisma.marketingDemoLead.findMany.mockResolvedValueOnce([
      { id: "lead_expired" },
    ]);

    await expect(sweepExpiredMarketingDemoLeads(25, now)).resolves.toBe(1);

    expect(database.prisma.marketingDemoLead.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["lead_expired"] } },
    });
    expect(
      database.prisma.marketingDemoLeadCapture.deleteMany,
    ).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});

it("preserves typed operational errors", () => {
  expect(new MarketingDemoLeadError("example", 418)).toMatchObject({
    code: "example",
    status: 418,
  });
});
