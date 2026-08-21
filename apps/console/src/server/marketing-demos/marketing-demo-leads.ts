import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { marketingDemoLeadSubmissionSchema } from "@prelude/contracts";
import { prisma, type Prisma } from "@prelude/db";

const controlId = "global";
const consentVersion = "marketing-demo-email-v1";
const captureCleanupBatchSize = 100;
const defaultRetentionDays = 730;
const withdrawnRetentionDays = 30;
const deliveryLeaseMs = 5 * 60 * 1000;
const maxDeliveryBackoffMs = 24 * 60 * 60 * 1000;

export async function captureMarketingDemoLead(
  input: unknown,
  now = new Date(),
) {
  const parsed = marketingDemoLeadSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    throw new MarketingDemoLeadError("invalid_lead", 400);
  }
  const email = normalizeEmail(parsed.data.email);
  const tokenDigest = digestCaptureToken(parsed.data.captureToken);
  const day = utcDay(now);

  try {
    return await prisma.$transaction(async (tx) => {
      await cleanupExpiredCaptureTokens(tx, now);
      const control = await tx.marketingDemoControl.update({
        data: { lockedAt: now },
        where: { id: controlId },
      });
      if (!control.enabled) {
        throw new MarketingDemoLeadError("lead_capture_unavailable", 503);
      }

      const capture = await tx.marketingDemoLeadCapture.findUnique({
        where: { tokenDigest },
      });
      if (!capture || capture.expiresAt <= now) {
        throw new MarketingDemoLeadError("lead_capture_not_found", 404);
      }

      const usage = await tx.marketingDemoDailyUsage.upsert({
        create: { day, leadCount: 0, startedCount: 0 },
        update: {},
        where: { day },
      });
      if (usage.leadCount >= control.dailyLeadCap) {
        throw new MarketingDemoLeadError("lead_capture_rate_limited", 429);
      }

      const consumed = await tx.marketingDemoLeadCapture.deleteMany({
        where: {
          expiresAt: { gt: now },
          tokenDigest,
        },
      });
      if (consumed.count !== 1) {
        throw new MarketingDemoLeadError("lead_capture_not_found", 404);
      }

      const lead = await tx.marketingDemoLead.upsert({
        create: {
          consentVersion: parsed.data.marketingConsent ? consentVersion : null,
          consentedAt: parsed.data.marketingConsent ? now : null,
          email,
          lastSubmittedAt: now,
          marketingConsent: parsed.data.marketingConsent,
          roleSlug: capture.roleSlug,
        },
        select: { id: true },
        update: {
          lastSubmittedAt: now,
          roleSlug: capture.roleSlug,
          ...(parsed.data.marketingConsent
            ? {
                consentVersion,
                consentedAt: now,
                marketingConsent: true,
                withdrawnAt: null,
              }
            : {}),
        },
        where: { email },
      });
      await tx.marketingDemoLeadOutbox.create({
        data: {
          eventType: "setup_requested",
          id: `mdlo_${randomBytes(18).toString("base64url")}`,
          leadId: lead.id,
          nextAttemptAt: now,
        },
      });
      if (parsed.data.marketingConsent) {
        await tx.marketingDemoLeadOutbox.create({
          data: {
            eventType: "consent_granted",
            id: `mdlo_${randomBytes(18).toString("base64url")}`,
            leadId: lead.id,
            nextAttemptAt: now,
          },
        });
      }
      await tx.marketingDemoDailyUsage.update({
        data: { leadCount: { increment: 1 } },
        where: { day },
      });

      return { accepted: true as const };
    });
  } catch (error) {
    if (error instanceof MarketingDemoLeadError) {
      throw error;
    }
    throw new MarketingDemoLeadError("lead_capture_unavailable", 503);
  }
}

export async function withdrawMarketingDemoLead(
  token: string,
  now = new Date(),
) {
  const leadId = verifyUnsubscribeToken(token);
  try {
    await prisma.$transaction(async (tx) => {
      const withdrawn = await tx.marketingDemoLead.updateMany({
        data: { marketingConsent: false, withdrawnAt: now },
        where: { id: leadId, marketingConsent: true, withdrawnAt: null },
      });
      if (withdrawn.count !== 1) {
        return;
      }
      await tx.marketingDemoLeadOutbox.updateMany({
        data: {
          lastErrorCode: null,
          processingLeaseExpiresAt: null,
          status: "cancelled",
        },
        where: {
          deliveredAt: null,
          eventType: "consent_granted",
          leadId,
          status: { in: ["pending", "processing"] },
        },
      });
      await tx.marketingDemoLeadOutbox.create({
        data: {
          eventType: "consent_withdrawn",
          id: `mdlo_${randomBytes(18).toString("base64url")}`,
          leadId,
          nextAttemptAt: now,
        },
      });
    });
    return { withdrawn: true as const };
  } catch (error) {
    if (error instanceof MarketingDemoLeadError) {
      throw error;
    }
    throw new MarketingDemoLeadError("lead_withdrawal_unavailable", 503);
  }
}

export async function processMarketingDemoLeadOperations(input: {
  limit: number;
  now?: Date;
  request?: typeof fetch;
}) {
  const now = input.now ?? new Date();
  const removed = await sweepExpiredMarketingDemoLeads(input.limit, now);
  const delivery = await deliverMarketingDemoLeadOutbox({
    limit: input.limit,
    now,
    request: input.request ?? fetch,
  });
  return { ...delivery, removed };
}

export async function sweepExpiredMarketingDemoLeads(
  limit: number,
  now = new Date(),
) {
  const retentionCutoff = new Date(
    now.getTime() - leadRetentionDays() * 24 * 60 * 60 * 1000,
  );
  const withdrawnCutoff = new Date(
    now.getTime() - withdrawnRetentionDays * 24 * 60 * 60 * 1000,
  );
  const expired = await prisma.marketingDemoLead.findMany({
    orderBy: { lastSubmittedAt: "asc" },
    select: { id: true },
    take: limit,
    where: {
      OR: [
        {
          consentedAt: { lte: retentionCutoff },
          marketingConsent: true,
        },
        {
          lastSubmittedAt: { lte: withdrawnCutoff },
          marketingConsent: false,
        },
        { withdrawnAt: { lte: withdrawnCutoff } },
      ],
    },
  });
  if (expired.length > 0) {
    await prisma.marketingDemoLead.deleteMany({
      where: { id: { in: expired.map((lead) => lead.id) } },
    });
  }
  await prisma.marketingDemoLeadCapture.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return expired.length;
}

async function deliverMarketingDemoLeadOutbox(input: {
  limit: number;
  now: Date;
  request: typeof fetch;
}) {
  const provider = marketingDemoLeadWebhookConfig();
  let delivered = 0;
  let failed = 0;

  for (let index = 0; index < input.limit; index += 1) {
    const candidate = await prisma.marketingDemoLeadOutbox.findFirst({
      include: { lead: true },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      where: {
        OR: [
          { nextAttemptAt: { lte: input.now }, status: "pending" },
          {
            processingLeaseExpiresAt: { lte: input.now },
            status: "processing",
          },
        ],
      },
    });
    if (!candidate) {
      break;
    }

    const leaseExpiresAt = new Date(input.now.getTime() + deliveryLeaseMs);
    const claimed = await prisma.marketingDemoLeadOutbox.updateMany({
      data: {
        attemptCount: { increment: 1 },
        processingLeaseExpiresAt: leaseExpiresAt,
        status: "processing",
      },
      where: {
        id: candidate.id,
        OR: [
          { nextAttemptAt: { lte: input.now }, status: "pending" },
          {
            processingLeaseExpiresAt: { lte: input.now },
            status: "processing",
          },
        ],
      },
    });
    if (claimed.count !== 1) {
      continue;
    }

    if (
      candidate.eventType === "consent_granted" &&
      candidate.lead.withdrawnAt !== null
    ) {
      await prisma.marketingDemoLeadOutbox.update({
        data: {
          processingLeaseExpiresAt: null,
          status: "cancelled",
        },
        where: { id: candidate.id },
      });
      continue;
    }

    const response = await input
      .request(provider.url, {
        body: JSON.stringify({
          consentVersion: candidate.lead.consentVersion,
          consentedAt: candidate.lead.consentedAt?.toISOString() ?? null,
          email: candidate.lead.email,
          eventId: candidate.id,
          eventType: candidate.eventType,
          marketingConsent: candidate.lead.marketingConsent,
          roleSlug: candidate.lead.roleSlug,
          unsubscribeUrl: marketingDemoLeadUnsubscribeUrl(candidate.lead.id),
          withdrawnAt: candidate.lead.withdrawnAt?.toISOString() ?? null,
        }),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${provider.secret}`,
          "content-type": "application/json",
          "idempotency-key": candidate.id,
        },
        method: "POST",
      })
      .catch(() => null);

    if (response?.ok) {
      delivered += 1;
      await prisma.marketingDemoLeadOutbox.update({
        data: {
          deliveredAt: input.now,
          lastErrorCode: null,
          processingLeaseExpiresAt: null,
          status: "delivered",
        },
        where: { id: candidate.id },
      });
      continue;
    }

    failed += 1;
    const attemptCount = candidate.attemptCount + 1;
    await prisma.marketingDemoLeadOutbox.update({
      data: {
        lastErrorCode: response ? `http_${response.status}` : "network",
        nextAttemptAt: new Date(
          input.now.getTime() + deliveryBackoffMs(attemptCount),
        ),
        processingLeaseExpiresAt: null,
        status: "pending",
      },
      where: { id: candidate.id },
    });
  }

  return { delivered, failed };
}

function marketingDemoLeadWebhookConfig() {
  const configuredUrl = process.env.MARKETING_DEMO_LEAD_WEBHOOK_URL?.trim();
  const secret = process.env.MARKETING_DEMO_LEAD_WEBHOOK_SECRET?.trim();
  if (!configuredUrl || !secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new MarketingDemoLeadError("lead_delivery_unavailable", 503);
  }
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new MarketingDemoLeadError("lead_delivery_unavailable", 503);
  }
  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    (isProduction() && url.protocol !== "https:")
  ) {
    throw new MarketingDemoLeadError("lead_delivery_unavailable", 503);
  }
  return { secret, url };
}

function marketingDemoLeadUnsubscribeUrl(leadId: string) {
  const token = createUnsubscribeToken(leadId);
  const origin = new URL(
    process.env.NEXT_PUBLIC_CONSOLE_URL ?? "http://localhost:3000",
  );
  if (isProduction() && origin.protocol !== "https:") {
    throw new MarketingDemoLeadError("lead_delivery_unavailable", 503);
  }
  const url = new URL("/demo/unsubscribe", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function createUnsubscribeToken(leadId: string) {
  const encodedId = Buffer.from(leadId, "utf8").toString("base64url");
  const signature = signUnsubscribeId(leadId);
  return `mdlu_${encodedId}.${signature}`;
}

function verifyUnsubscribeToken(token: string) {
  const match = /^mdlu_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(token);
  if (!match) {
    throw new MarketingDemoLeadError("invalid_unsubscribe_token", 400);
  }
  let leadId: string;
  try {
    leadId = Buffer.from(match[1] ?? "", "base64url").toString("utf8");
  } catch {
    throw new MarketingDemoLeadError("invalid_unsubscribe_token", 400);
  }
  if (!leadId || leadId.length > 160) {
    throw new MarketingDemoLeadError("invalid_unsubscribe_token", 400);
  }
  const expected = Buffer.from(signUnsubscribeId(leadId));
  const provided = Buffer.from(match[2] ?? "");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new MarketingDemoLeadError("invalid_unsubscribe_token", 400);
  }
  return leadId;
}

function signUnsubscribeId(leadId: string) {
  return createHmac("sha256", unsubscribeSecret())
    .update(`marketing-demo-unsubscribe-v1:${leadId}`)
    .digest("base64url");
}

function unsubscribeSecret() {
  const secret = process.env.MARKETING_DEMO_LEAD_UNSUBSCRIBE_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new MarketingDemoLeadError("lead_withdrawal_unavailable", 503);
  }
  return secret;
}

function normalizeEmail(value: string) {
  return value.normalize("NFKC").trim().toLowerCase();
}

function digestCaptureToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function deliveryBackoffMs(attemptCount: number) {
  return Math.min(
    maxDeliveryBackoffMs,
    60_000 * 2 ** Math.max(0, attemptCount - 1),
  );
}

function leadRetentionDays() {
  const configured = Number(process.env.MARKETING_DEMO_LEAD_RETENTION_DAYS);
  return Number.isInteger(configured) && configured >= 30 && configured <= 3_650
    ? configured
    : defaultRetentionDays;
}

function utcDay(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function isProduction() {
  return (
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

async function cleanupExpiredCaptureTokens(
  tx: Prisma.TransactionClient,
  now: Date,
) {
  const expired = await tx.marketingDemoLeadCapture.findMany({
    select: { id: true },
    take: captureCleanupBatchSize,
    where: { expiresAt: { lte: now } },
  });
  if (expired.length > 0) {
    await tx.marketingDemoLeadCapture.deleteMany({
      where: { id: { in: expired.map((capture) => capture.id) } },
    });
  }
}

export class MarketingDemoLeadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "MarketingDemoLeadError";
  }
}
