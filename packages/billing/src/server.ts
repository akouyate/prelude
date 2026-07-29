import { createClerkClient } from "@clerk/backend";
import { Prisma, prisma } from "@prelude/db";

import {
  normalizeBillingSubscription,
  resolveBillingUsagePeriod,
  resolveBillingRuntime,
  unavailableBilling,
  unconfiguredBilling,
  workspacePlanCatalog,
  type WorkspaceBilling,
  type WorkspaceBillingState,
} from "./billing-policy";
import {
  mapClerkBillingSubscription,
  type ClerkBillingSubscription,
} from "./clerk-billing";

const defaultPaidPlanSlug = "v1-workspace";
const DEFAULT_PROJECTION_MAX_AGE_MS = 35 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_SOURCE_UPDATED_AT = new Date(0);

export type BillingProjection = {
  clerkPlanId: string | null;
  clerkSubscriptionId: string | null;
  isFreeTrial: boolean;
  periodEnd: Date | null;
  periodStart: Date | null;
  planName: string | null;
  planSlug: string | null;
  sourceUpdatedAt: Date;
  state: string;
  syncedAt: Date;
  subscriptionItemId: string | null;
  subscriptionItemStatus: string | null;
  subscriptionStatus: string | null;
};

type BillingProjectionWrite = Omit<BillingProjection, "syncedAt"> & {
  organizationId: string;
  syncedAt?: Date;
};

export interface BillingStore {
  countCandidateInterviews(input: {
    organizationId: string;
    periodEnd: Date | null;
    periodStart: Date | null;
  }): Promise<number>;
  countPublishedRoles(input: { organizationId: string }): Promise<number>;
  findBillingProjection(
    organizationId: string,
  ): Promise<BillingProjection | null>;
  findOrganizationIdByClerkId(
    clerkOrganizationId: string,
  ): Promise<string | null>;
  upsertBillingProjectionIfNewer(
    projection: BillingProjectionWrite,
  ): Promise<boolean>;
}

export type ClerkBillingClient = {
  getOrganizationBillingSubscription(
    organizationId: string,
  ): Promise<ClerkBillingSubscription>;
};

type BillingServiceOptions = {
  appEnv?: string;
  billingEnabled: boolean;
  clerk: ClerkBillingClient;
  paidPlanSlug: string;
  projectionMaxAgeMs?: number;
  store: BillingStore;
};

type WorkspaceBillingInput = { organizationId: string; now?: Date };

export function createBillingService({
  appEnv,
  billingEnabled,
  clerk,
  paidPlanSlug,
  projectionMaxAgeMs = DEFAULT_PROJECTION_MAX_AGE_MS,
  store,
}: BillingServiceOptions) {
  async function getWorkspaceBilling({
    organizationId,
    now = new Date(),
  }: WorkspaceBillingInput): Promise<WorkspaceBilling> {
    const runtime = resolveBillingRuntime({ appEnv, billingEnabled });
    if (runtime === "unconfigured") {
      return unconfiguredBilling(now);
    }
    if (runtime === "unavailable") {
      return unavailableBilling(now);
    }

    const projection = await store.findBillingProjection(organizationId);
    return projection
      ? billingFromProjection(
          projection,
          paidPlanSlug,
          now,
          projectionMaxAgeMs,
        )
      : unavailableBilling(now);
  }

  async function getWorkspaceBillingOverview({
    organizationId,
    now,
  }: WorkspaceBillingInput) {
    const effectiveNow = now ?? new Date();
    const billing = await getWorkspaceBilling({
      organizationId,
      now: effectiveNow,
    });
    const period = resolveBillingUsagePeriod(billing, effectiveNow);
    const [candidateInterviews, publishedRoles] = await Promise.all([
      store.countCandidateInterviews({
        organizationId,
        periodEnd: period.end,
        periodStart: period.start,
      }),
      store.countPublishedRoles({ organizationId }),
    ]);

    return {
      billing,
      limits: {
        candidateInterviews: billing.entitlements.candidateInterviewLimit,
        publishedRoles: billing.entitlements.activeRoleLimit,
      },
      usage: { candidateInterviews, publishedRoles },
    };
  }

  async function syncClerkOrganizationBilling({
    clerkOrganizationId,
    sourceUpdatedAt,
  }: {
    clerkOrganizationId: string;
    sourceUpdatedAt?: Date;
  }): Promise<{ applied: boolean; reason?: string }> {
    const runtime = resolveBillingRuntime({ appEnv, billingEnabled });
    if (runtime !== "configured") {
      return { applied: false, reason: `billing_${runtime}` };
    }

    const organizationId =
      await store.findOrganizationIdByClerkId(clerkOrganizationId);
    if (!organizationId) {
      return { applied: false, reason: "organization_not_found" };
    }

    if (sourceUpdatedAt) {
      const current = await store.findBillingProjection(organizationId);
      if (current && current.sourceUpdatedAt >= sourceUpdatedAt) {
        return { applied: false, reason: "stale_source_update" };
      }
    }

    const subscription = mapClerkBillingSubscription(
      await clerk.getOrganizationBillingSubscription(clerkOrganizationId),
    );
    const billing = normalizeBillingSubscription(subscription, {
      now: new Date(),
      paidPlanSlug,
    });
    const applied = await store.upsertBillingProjectionIfNewer({
      clerkPlanId: billing.planId,
      clerkSubscriptionId: billing.subscriptionId,
      isFreeTrial: billing.isFreeTrial,
      organizationId,
      periodEnd: billing.periodEnd,
      periodStart: billing.periodStart,
      planName: billing.planName,
      planSlug: billing.planSlug,
      sourceUpdatedAt: billing.sourceUpdatedAt,
      state: billing.state,
      subscriptionItemId: billing.subscriptionItemId,
      subscriptionItemStatus: billing.subscriptionItemStatus,
      subscriptionStatus: billing.subscriptionStatus,
    });
    return applied
      ? { applied: true }
      : { applied: false, reason: "stale_source_update" };
  }

  async function initializeFreeWorkspaceBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<boolean> {
    const runtime = resolveBillingRuntime({ appEnv, billingEnabled });
    if (runtime !== "configured") {
      return false;
    }

    return store.upsertBillingProjectionIfNewer({
      clerkPlanId: null,
      clerkSubscriptionId: null,
      isFreeTrial: false,
      organizationId,
      periodEnd: null,
      periodStart: null,
      planName: "Free",
      planSlug: "free",
      sourceUpdatedAt: BOOTSTRAP_SOURCE_UPDATED_AT,
      state: "free",
      subscriptionItemId: null,
      subscriptionItemStatus: "active",
      subscriptionStatus: "active",
      syncedAt: new Date(),
    });
  }

  return {
    getWorkspaceBilling,
    getWorkspaceBillingOverview,
    initializeFreeWorkspaceBilling,
    syncClerkOrganizationBilling,
  };
}

const prismaBillingStore: BillingStore = {
  async countCandidateInterviews({ organizationId, periodEnd, periodStart }) {
    return prisma.candidateSession.count({
      where: {
        organizationId,
        startedAt:
          periodStart || periodEnd
            ? {
                ...(periodStart ? { gte: periodStart } : {}),
                ...(periodEnd ? { lt: periodEnd } : {}),
              }
            : undefined,
        OR: [
          { status: { not: "failed" } },
          { realtimeSessionId: { not: null } },
        ],
      },
    });
  },

  async countPublishedRoles({ organizationId }) {
    return prisma.job.count({
      where: {
        organizationId,
        interviews: {
          some: { status: "published" },
        },
      },
    });
  },

  async findBillingProjection(organizationId) {
    return prisma.organizationBillingState.findUnique({
      select: {
        clerkPlanId: true,
        clerkSubscriptionId: true,
        isFreeTrial: true,
        periodEnd: true,
        periodStart: true,
        planName: true,
        planSlug: true,
        sourceUpdatedAt: true,
        state: true,
        subscriptionItemId: true,
        subscriptionItemStatus: true,
        subscriptionStatus: true,
        syncedAt: true,
      },
      where: { organizationId },
    });
  },

  async findOrganizationIdByClerkId(clerkOrganizationId) {
    const organization = await prisma.organization.findUnique({
      select: { id: true },
      where: { clerkOrganizationId },
    });
    return organization?.id ?? null;
  },

  async upsertBillingProjectionIfNewer(projection) {
    const data = projectionData(projection);
    const updated = await prisma.organizationBillingState.updateMany({
      data,
      where: {
        organizationId: projection.organizationId,
        sourceUpdatedAt: { lte: projection.sourceUpdatedAt },
      },
    });
    if (updated.count > 0) {
      return true;
    }

    try {
      await prisma.organizationBillingState.create({
        data: { organizationId: projection.organizationId, ...data },
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      const retried = await prisma.organizationBillingState.updateMany({
        data,
        where: {
          organizationId: projection.organizationId,
          sourceUpdatedAt: { lte: projection.sourceUpdatedAt },
        },
      });
      return retried.count > 0;
    }
  },
};

const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkClient = createClerkClient({ secretKey: clerkSecretKey });
const billingService = createBillingService({
  appEnv: process.env.NODE_ENV,
  billingEnabled:
    isEnabled(process.env.CLERK_BILLING_ENABLED) && Boolean(clerkSecretKey),
  clerk: {
    getOrganizationBillingSubscription: (organizationId) =>
      clerkClient.billing.getOrganizationBillingSubscription(organizationId),
  },
  paidPlanSlug: process.env.CLERK_BILLING_V1_PLAN_SLUG ?? defaultPaidPlanSlug,
  projectionMaxAgeMs: projectionMaxAgeMsFromEnv(
    process.env.CLERK_BILLING_PROJECTION_MAX_AGE_SECONDS,
  ),
  store: prismaBillingStore,
});

/** Reads only HireCall's local billing projection; it never calls Clerk. */
export const getWorkspaceBilling = billingService.getWorkspaceBilling;
export const getWorkspaceBillingOverview =
  billingService.getWorkspaceBillingOverview;
/** Seeds the safe default plan before the first Clerk webhook can be trusted. */
export const initializeFreeWorkspaceBilling =
  billingService.initializeFreeWorkspaceBilling;
/** Refreshes the projection from Clerk's canonical organization subscription. */
export const syncClerkOrganizationBilling =
  billingService.syncClerkOrganizationBilling;
export { mapClerkBillingSubscription } from "./clerk-billing";

function billingFromProjection(
  projection: BillingProjection,
  paidPlanSlug: string,
  now: Date,
  projectionMaxAgeMs: number,
): WorkspaceBilling {
  if (
    projection.state === "canceled" &&
    projection.periodEnd &&
    projection.periodEnd <= now
  ) {
    return freeBillingFromExpiredProjection(projection);
  }

  if (
    projection.planSlug === paidPlanSlug &&
    ((projection.periodEnd && projection.periodEnd <= now) ||
      now.getTime() - projection.syncedAt.getTime() > projectionMaxAgeMs)
  ) {
    return unavailableBilling(now, {
      sourceUpdatedAt: projection.sourceUpdatedAt,
    });
  }

  const state = isProjectedBillingState(projection.state)
    ? projection.state
    : "unavailable";
  const planKey =
    projection.planSlug === paidPlanSlug
      ? "v1_workspace"
      : state === "free"
        ? "free"
        : "unknown";
  const accessAllowed =
    planKey !== "unknown" &&
    (state === "active" ||
      state === "canceled" ||
      state === "free" ||
      state === "trialing");

  return {
    accessAllowed,
    entitlements: accessAllowed
      ? workspacePlanCatalog[planKey]
      : workspacePlanCatalog.unknown,
    isFreeTrial: projection.isFreeTrial,
    periodEnd: projection.periodEnd,
    periodStart: projection.periodStart,
    planId: projection.clerkPlanId,
    planKey,
    planName:
      projection.planName ??
      (planKey === "free" ? "Free" : "Billing unavailable"),
    planSlug: projection.planSlug,
    sourceUpdatedAt: projection.sourceUpdatedAt,
    state,
    subscriptionId: projection.clerkSubscriptionId,
    subscriptionItemId: projection.subscriptionItemId,
    subscriptionItemStatus: projection.subscriptionItemStatus,
    subscriptionStatus: projection.subscriptionStatus,
  };
}

function isProjectedBillingState(
  value: string,
): value is WorkspaceBillingState {
  return [
    "active",
    "canceled",
    "free",
    "past_due",
    "trialing",
    "unavailable",
  ].includes(value);
}

function projectionData({
  organizationId: _,
  syncedAt: _syncedAt,
  ...projection
}: BillingProjectionWrite) {
  return { ...projection, syncedAt: new Date() };
}

function isUniqueConstraintViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

function freeBillingFromExpiredProjection(
  projection: BillingProjection,
): WorkspaceBilling {
  return {
    accessAllowed: true,
    entitlements: workspacePlanCatalog.free,
    isFreeTrial: false,
    periodEnd: null,
    periodStart: null,
    planId: null,
    planKey: "free",
    planName: "Free",
    planSlug: "free",
    sourceUpdatedAt: projection.sourceUpdatedAt,
    state: "free",
    subscriptionId: projection.clerkSubscriptionId,
    subscriptionItemId: null,
    subscriptionItemStatus: null,
    subscriptionStatus: projection.subscriptionStatus,
  };
}

function projectionMaxAgeMsFromEnv(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_PROJECTION_MAX_AGE_MS;
}
