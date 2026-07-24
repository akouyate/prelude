import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    billing: { getOrganizationBillingSubscription: vi.fn() },
  }),
}));

vi.mock("@prelude/db", () => ({
  Prisma: { PrismaClientKnownRequestError: class PrismaClientKnownRequestError {} },
  prisma: {},
}));

import {
  createBillingService,
  type BillingProjection,
  type BillingStore,
} from "./server";

const now = new Date("2026-07-24T10:00:00.000Z");

describe("billing server service", () => {
  it("reads a configured workspace exclusively from its projection", async () => {
    const store = fakeStore({ projection: projection() });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({ planKey: "v1_workspace", state: "active" });
    expect(store.findBillingProjection).toHaveBeenCalledWith("org_db_1");
    expect(store.countCandidateInterviews).not.toHaveBeenCalled();
  });

  it("fails closed when a paid projection is stale", async () => {
    const store = fakeStore({
      projection: projection({
        syncedAt: new Date("2026-07-22T09:59:59.000Z"),
      }),
    });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      projectionMaxAgeMs: 24 * 60 * 60 * 1000,
      store,
    });

    await expect(
      service.getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({
      accessAllowed: false,
      state: "unavailable",
    });
  });

  it("downgrades an expired canceled paid projection to Free", async () => {
    const store = fakeStore({
      projection: projection({
        periodEnd: new Date("2026-07-24T09:59:59.000Z"),
        state: "canceled",
        subscriptionItemStatus: "canceled",
        subscriptionStatus: "canceled",
      }),
    });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({
      accessAllowed: true,
      planKey: "free",
      state: "free",
    });
  });

  it("fails closed when an active paid period has ended without renewal", async () => {
    const store = fakeStore({
      projection: projection({
        periodEnd: new Date("2026-07-24T09:59:59.000Z"),
      }),
    });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({
      accessAllowed: false,
      state: "unavailable",
    });
  });

  it("is unconfigured locally and unavailable in production when billing is disabled", async () => {
    const store = fakeStore();

    await expect(
      createBillingService({
        appEnv: "development",
        billingEnabled: false,
        clerk: fakeClerk(),
        paidPlanSlug: "v1-workspace",
        store,
      }).getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({ state: "unconfigured", accessAllowed: true });

    await expect(
      createBillingService({
        appEnv: "production",
        billingEnabled: false,
        clerk: fakeClerk(),
        paidPlanSlug: "v1-workspace",
        store,
      }).getWorkspaceBilling({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({ state: "unavailable", accessAllowed: false });
  });

  it("returns product usage and plan limits from the local projection", async () => {
    const store = fakeStore({ projection: projection() });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.getWorkspaceBillingOverview({ organizationId: "org_db_1", now }),
    ).resolves.toMatchObject({
      usage: { candidateInterviews: 9, publishedRoles: 3 },
      limits: { candidateInterviews: 250, publishedRoles: 25 },
    });
    expect(store.countCandidateInterviews).toHaveBeenCalledWith({
      organizationId: "org_db_1",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("uses the current UTC month for usage when Free has no provider period", async () => {
    const store = fakeStore({
      projection: projection({
        clerkPlanId: null,
        clerkSubscriptionId: null,
        periodEnd: null,
        periodStart: null,
        planName: "Free",
        planSlug: "free",
        state: "free",
        subscriptionItemId: null,
      }),
    });
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await service.getWorkspaceBillingOverview({
      organizationId: "org_db_1",
      now,
    });

    expect(store.countCandidateInterviews).toHaveBeenCalledWith({
      organizationId: "org_db_1",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("refetches Clerk's canonical subscription and applies only newer source state", async () => {
    const store = fakeStore({ organizationId: "org_db_1" });
    const clerk = fakeClerk();
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk,
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.syncClerkOrganizationBilling({
        clerkOrganizationId: "org_clerk_1",
        sourceUpdatedAt: new Date("2026-07-24T09:00:00.000Z"),
      }),
    ).resolves.toEqual({ applied: true });

    expect(clerk.getOrganizationBillingSubscription).toHaveBeenCalledWith(
      "org_clerk_1",
    );
    expect(store.upsertBillingProjectionIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_db_1",
        sourceUpdatedAt: new Date("2026-07-24T10:00:00.000Z"),
        planSlug: "v1-workspace",
        state: "active",
      }),
    );
  });

  it("does not call Clerk for a stale webhook source update", async () => {
    const store = fakeStore({
      organizationId: "org_db_1",
      projection: projection({
        sourceUpdatedAt: new Date("2026-07-24T11:00:00.000Z"),
      }),
    });
    const clerk = fakeClerk();
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk,
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.syncClerkOrganizationBilling({
        clerkOrganizationId: "org_clerk_1",
        sourceUpdatedAt: new Date("2026-07-24T09:00:00.000Z"),
      }),
    ).resolves.toEqual({ applied: false, reason: "stale_source_update" });
    expect(clerk.getOrganizationBillingSubscription).not.toHaveBeenCalled();
  });

  it("seeds a safe Free projection that canonical Clerk state can supersede", async () => {
    const store = fakeStore();
    const service = createBillingService({
      appEnv: "production",
      billingEnabled: true,
      clerk: fakeClerk(),
      paidPlanSlug: "v1-workspace",
      store,
    });

    await expect(
      service.initializeFreeWorkspaceBilling({
        organizationId: "org_db_1",
      }),
    ).resolves.toBe(true);

    expect(store.upsertBillingProjectionIfNewer).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_db_1",
        planSlug: "free",
        sourceUpdatedAt: new Date(0),
        state: "free",
      }),
    );
  });
});

function projection(overrides: Partial<BillingProjection> = {}): BillingProjection {
  return {
    clerkPlanId: "plan_v1",
    clerkSubscriptionId: "sub_123",
    isFreeTrial: false,
    periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    planName: "V1 Workspace",
    planSlug: "v1-workspace",
    sourceUpdatedAt: new Date("2026-07-24T10:00:00.000Z"),
    state: "active",
    syncedAt: new Date("2026-07-24T10:00:00.000Z"),
    subscriptionItemId: "subitem_123",
    subscriptionItemStatus: "active",
    subscriptionStatus: "active",
    ...overrides,
  };
}

function fakeStore({
  organizationId = null,
  projection: currentProjection = null,
}: {
  organizationId?: string | null;
  projection?: BillingProjection | null;
} = {}): BillingStore {
  return {
    countCandidateInterviews: vi.fn(async () => 9),
    countPublishedRoles: vi.fn(async () => 3),
    findBillingProjection: vi.fn(async () => currentProjection),
    findOrganizationIdByClerkId: vi.fn(async () => organizationId),
    upsertBillingProjectionIfNewer: vi.fn(async () => true),
  };
}

function fakeClerk() {
  return {
    getOrganizationBillingSubscription: vi.fn(async () => ({
      id: "sub_123",
      status: "active" as const,
      subscriptionItems: [
        {
          id: "subitem_123",
          status: "active" as const,
          plan: {
            id: "plan_v1",
            isDefault: false,
            name: "V1 Workspace",
            slug: "v1-workspace",
          },
          planId: "plan_v1",
          periodEnd: Date.parse("2026-08-01T00:00:00.000Z"),
          periodStart: Date.parse("2026-07-01T00:00:00.000Z"),
          isFreeTrial: false,
          updatedAt: Date.parse("2026-07-24T10:00:00.000Z"),
        },
      ],
      updatedAt: Date.parse("2026-07-24T10:00:00.000Z"),
    })),
  };
}
