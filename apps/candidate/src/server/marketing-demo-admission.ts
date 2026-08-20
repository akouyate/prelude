import { randomBytes } from "node:crypto";

import {
  CANDIDATE_PREVIEW_SCHEMA_VERSION,
  candidateExperiencePreviewSnapshotSchema,
  marketingDemoPostInterviewQuestionsSchema,
  marketingDemoPublicRoleSchema,
  parseStoredInterviewPlan,
} from "@prelude/contracts";
import { prisma, type Prisma } from "@prelude/db";

import {
  MarketingDemoRequestError,
  digestOpaqueSecret,
  isAllowedMarketingDemoReturnTarget,
  isMarketingDemoProduction,
  marketingDemoHandoffEncryptionKey,
  marketingDemoPolicy,
} from "./marketing-demo-security";

const controlId = "global";
const demoSystemUserId = "user_marketing_demo_system";
const cleanupBatchSize = 50;

export async function listMarketingDemoRoles(now = new Date()) {
  marketingDemoHandoffEncryptionKey();
  try {
    return await prisma.$transaction(async (tx) => {
      await cleanupExpiredLaunches(tx, now);
      const control = await tx.marketingDemoControl.findUnique({
        where: { id: controlId },
      });
      if (!control?.enabled) {
        throw new MarketingDemoRequestError("demo_unavailable", 503);
      }

      const roles = await tx.marketingDemoRole.findMany({
        orderBy: [{ displayOrder: "asc" }, { slug: "asc" }],
        take: 12,
        where: { enabled: true },
      });
      const publicRoles = roles.flatMap((role) => {
        const parsed = marketingDemoPublicRoleSchema.safeParse({
          badge: role.publicBadge,
          locale: role.locale,
          slug: role.slug,
          summary: role.publicSummary,
          title: role.publicTitle,
          version: role.version,
        });
        return parsed.success ? [parsed.data] : [];
      });
      if (publicRoles.length === 0) {
        throw new MarketingDemoRequestError("demo_unavailable", 503);
      }

      const launchNonce = `mdln_${randomBytes(32).toString("base64url")}`;
      const launchNonceExpiresAt = new Date(
        now.getTime() + marketingDemoPolicy.launchNonceTtlMs,
      );
      await tx.marketingDemoLaunch.create({
        data: {
          expiresAt: launchNonceExpiresAt,
          id: `mdl_${randomBytes(18).toString("base64url")}`,
          nonceDigest: digestOpaqueSecret(launchNonce),
        },
      });

      return {
        launchNonce,
        launchNonceExpiresAt: launchNonceExpiresAt.toISOString(),
        roles: publicRoles,
      };
    });
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      throw error;
    }
    throw new MarketingDemoRequestError("demo_controls_unavailable", 503);
  }
}

export async function createMarketingDemoPreview(
  input: {
    launchNonce: string;
    returnTarget: string;
    roleSlug: string;
  },
  now = new Date(),
) {
  if (!isAllowedMarketingDemoReturnTarget(input.returnTarget)) {
    throw new MarketingDemoRequestError("invalid_return_target", 400);
  }
  // Refuse admission before consuming the visitor's launch nonce if the
  // single-use result relay cannot encrypt its eventual payload.
  marketingDemoHandoffEncryptionKey();

  const launchNonceDigest = digestOpaqueSecret(input.launchNonce);
  const rawToken = `pvtk_${randomBytes(32).toString("base64url")}`;
  const previewId = `pv_${randomBytes(18).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + marketingDemoPolicy.accessTtlMs);

  try {
    await prisma.$transaction(async (tx) => {
      await cleanupExpiredLaunches(tx, now);
      const control = await tx.marketingDemoControl.findUnique({
        where: { id: controlId },
      });
      if (!control?.enabled) {
        throw new MarketingDemoRequestError("demo_unavailable", 503);
      }

      const consumed = await tx.marketingDemoLaunch.updateMany({
        data: { usedAt: now },
        where: {
          expiresAt: { gt: now },
          nonceDigest: launchNonceDigest,
          usedAt: null,
        },
      });
      if (consumed.count !== 1) {
        throw new MarketingDemoRequestError("invalid_launch_nonce", 409);
      }

      const role = await tx.marketingDemoRole.findUnique({
        include: {
          draft: { include: { job: true, organization: true } },
        },
        where: { slug: input.roleSlug },
      });
      if (!role?.enabled) {
        throw new MarketingDemoRequestError("demo_role_not_found", 404);
      }

      const postInterviewQuestions =
        marketingDemoPostInterviewQuestionsSchema.parse(
          role.postInterviewQuestions,
        );
      const plan = parseStoredInterviewPlan({
        criteria: role.draft.criteria,
        estimatedMinutes: role.draft.estimatedMinutes,
        focus: role.draft.focus,
        guardrails: role.draft.guardrails,
        language: role.draft.language,
        questions: role.draft.questions,
        rationale: role.draft.rationale ?? "",
        responseModes: ["audio"],
        roleBrief: role.draft.roleBrief,
        roleTitle: role.draft.roleTitle,
        schemaVersion: role.draft.schemaVersion,
        seniority: role.draft.seniority,
      });
      const snapshot = candidateExperiencePreviewSnapshotSchema.parse({
        companyName: role.draft.organization.name,
        jobId: role.draft.jobId,
        jobTitle: role.draft.job.title,
        marketingDemo: {
          launchNonceDigest,
          locale: role.locale,
          postInterviewQuestions,
          returnTarget: new URL(input.returnTarget).toString(),
          roleSlug: role.slug,
          roleVersion: role.version,
        },
        plan,
        schemaVersion: CANDIDATE_PREVIEW_SCHEMA_VERSION,
        variant: "marketing_demo",
      });

      await tx.candidateExperiencePreview.create({
        data: {
          createdByUserId: demoSystemUserId,
          draftId: role.draftId,
          expiresAt,
          id: previewId,
          liveTestCount: 0,
          organizationId: role.draft.organizationId,
          runtimeExpiresAt: null,
          schemaVersion: CANDIDATE_PREVIEW_SCHEMA_VERSION,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          tokenDigest: digestOpaqueSecret(rawToken),
        },
      });
    });
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      throw error;
    }
    throw new MarketingDemoRequestError("demo_controls_unavailable", 503);
  }

  return {
    expiresAt: expiresAt.toISOString(),
    previewUrl: new URL(
      `/preview/${rawToken}`,
      candidateAppOrigin(),
    ).toString(),
  };
}

export async function reserveMarketingDemoStart(
  previewId: string,
  now = new Date(),
) {
  // Recheck at the cost-bearing realtime boundary so a bad key rotation cannot
  // admit a voice session that has no safe completion path.
  marketingDemoHandoffEncryptionKey();
  const runtimeExpiresAt = new Date(
    now.getTime() + marketingDemoPolicy.runtimeTtlMs,
  );
  const day = utcDay(now);

  try {
    return await prisma.$transaction(async (tx) => {
      // This write is the global mutex. Every starter locks the same control row
      // before it reads either cap, so the count-and-increment sequence is atomic
      // even across candidate-app replicas.
      const control = await tx.marketingDemoControl.update({
        data: { lockedAt: now },
        where: { id: controlId },
      });
      if (!control.enabled) {
        throw new MarketingDemoRequestError("demo_unavailable", 503);
      }

      const preview = await tx.candidateExperiencePreview.findUnique({
        select: {
          expiresAt: true,
          liveTestCount: true,
          revokedAt: true,
          runtimeExpiresAt: true,
          snapshot: true,
        },
        where: { id: previewId },
      });
      const snapshot = candidateExperiencePreviewSnapshotSchema.safeParse(
        preview?.snapshot,
      );
      if (
        !preview ||
        preview.expiresAt <= now ||
        preview.revokedAt ||
        preview.liveTestCount !== 0 ||
        !snapshot.success ||
        snapshot.data.schemaVersion !== CANDIDATE_PREVIEW_SCHEMA_VERSION ||
        snapshot.data.variant !== "marketing_demo"
      ) {
        throw new MarketingDemoRequestError("demo_already_started", 409);
      }
      const activeRole = await tx.marketingDemoRole.findUnique({
        select: { enabled: true },
        where: { slug: snapshot.data.marketingDemo.roleSlug },
      });
      if (!activeRole?.enabled) {
        throw new MarketingDemoRequestError("demo_role_not_found", 404);
      }

      const concurrentCount = await tx.candidateExperiencePreview.count({
        where: {
          completedAt: null,
          runtimeExpiresAt: { gt: now },
          snapshot: { path: ["variant"], equals: "marketing_demo" },
        },
      });
      if (concurrentCount >= control.concurrentSessionCap) {
        throw new MarketingDemoRequestError(
          "demo_concurrency_cap_reached",
          429,
        );
      }

      const usage = await tx.marketingDemoDailyUsage.upsert({
        create: { day, startedCount: 0 },
        update: {},
        where: { day },
      });
      if (usage.startedCount >= control.dailyStartedSessionCap) {
        throw new MarketingDemoRequestError("demo_daily_cap_reached", 429);
      }

      const reserved = await tx.candidateExperiencePreview.updateMany({
        data: {
          liveTestCount: { increment: 1 },
          runtimeExpiresAt,
          startedAt: now,
        },
        where: {
          expiresAt: { gt: now },
          id: previewId,
          liveTestCount: 0,
          revokedAt: null,
          runtimeExpiresAt: preview.runtimeExpiresAt,
        },
      });
      if (reserved.count !== 1) {
        throw new MarketingDemoRequestError("demo_already_started", 409);
      }

      await tx.marketingDemoDailyUsage.update({
        data: { startedCount: { increment: 1 } },
        where: { day },
      });

      return { day, previewId, runtimeExpiresAt };
    });
  } catch (error) {
    if (error instanceof MarketingDemoRequestError) {
      throw error;
    }
    throw new MarketingDemoRequestError("demo_controls_unavailable", 503);
  }
}

export async function releaseMarketingDemoStart(input: {
  day: Date;
  previewId: string;
  runtimeExpiresAt: Date;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.marketingDemoControl.update({
      data: { lockedAt: new Date() },
      where: { id: controlId },
    });
    const released = await tx.candidateExperiencePreview.updateMany({
      data: {
        completedAt: null,
        liveTestCount: 0,
        runtimeExpiresAt: null,
        startedAt: null,
      },
      where: {
        id: input.previewId,
        liveTestCount: 1,
        realtimeSessionId: null,
        runtimeExpiresAt: input.runtimeExpiresAt,
      },
    });
    if (released.count === 1) {
      await tx.marketingDemoDailyUsage.updateMany({
        data: { startedCount: { decrement: 1 } },
        where: { day: input.day, startedCount: { gt: 0 } },
      });
    }
  });
}

export async function confirmMarketingDemoProvisioning(input: {
  previewId: string;
  realtimeSessionId: string;
  runtimeExpiresAt: Date;
}) {
  const confirmed = await prisma.candidateExperiencePreview.updateMany({
    data: { realtimeSessionId: input.realtimeSessionId },
    where: {
      id: input.previewId,
      liveTestCount: 1,
      realtimeSessionId: null,
      runtimeExpiresAt: input.runtimeExpiresAt,
    },
  });
  if (confirmed.count !== 1) {
    throw new MarketingDemoRequestError(
      "demo_session_confirmation_failed",
      503,
    );
  }
}

function utcDay(now: Date) {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function cleanupExpiredLaunches(tx: Prisma.TransactionClient, now: Date) {
  const expired = await tx.marketingDemoLaunch.findMany({
    select: { id: true },
    take: cleanupBatchSize,
    where: { expiresAt: { lte: now } },
  });
  if (expired.length > 0) {
    await tx.marketingDemoLaunch.deleteMany({
      where: { id: { in: expired.map((launch) => launch.id) } },
    });
  }
}

function candidateAppOrigin() {
  const configured =
    process.env.NEXT_PUBLIC_CANDIDATE_URL ?? "http://localhost:3001";
  const url = new URL(configured);
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new MarketingDemoRequestError("candidate_origin_invalid", 503);
  }
  if (isMarketingDemoProduction() && url.protocol !== "https:") {
    throw new MarketingDemoRequestError("candidate_origin_invalid", 503);
  }
  return url.origin;
}
