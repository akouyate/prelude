import { describe, expect, it } from "vitest";

import {
  evaluateWorkspaceEntitlement,
  normalizeBillingSubscription,
  resolveBillingUsagePeriod,
  resolveBillingRuntime,
  workspacePlanCatalog,
  type BillingSubscriptionSnapshot,
} from "./billing-policy";

const now = new Date("2026-07-24T10:00:00.000Z");

describe("normalizeBillingSubscription", () => {
  it("maps Clerk's active default plan to Prelude Free", () => {
    const result = normalizeBillingSubscription(
      subscription({
        items: [
          item({
            isDefault: true,
            planName: "Free",
            planSlug: "free",
          }),
        ],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: true,
      planKey: "free",
      state: "free",
    });
    expect(result.entitlements).toEqual(workspacePlanCatalog.free);
  });

  it("maps an active paid trial to the V1 trial state", () => {
    const result = normalizeBillingSubscription(
      subscription({
        items: [
          item({
            isFreeTrial: true,
            planName: "V1 Workspace",
            planSlug: "v1-workspace",
          }),
        ],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: true,
      isFreeTrial: true,
      planKey: "v1_workspace",
      state: "trialing",
    });
  });

  it("keeps a canceled paid plan entitled through its period end", () => {
    const result = normalizeBillingSubscription(
      subscription({
        status: "canceled",
        items: [
          item({
            periodEnd: new Date("2026-08-01T00:00:00.000Z"),
            planSlug: "v1-workspace",
            status: "canceled",
          }),
        ],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: true,
      planKey: "v1_workspace",
      state: "canceled",
    });
  });

  it("falls back to Clerk's default Free plan after cancellation ends", () => {
    const result = normalizeBillingSubscription(
      subscription({
        status: "active",
        items: [
          item({
            id: "subitem_paid",
            periodEnd: new Date("2026-07-01T00:00:00.000Z"),
            planSlug: "v1-workspace",
            status: "canceled",
          }),
          item({
            id: "subitem_free",
            isDefault: true,
            planName: "Free",
            planSlug: "free",
            updatedAt: new Date("2026-07-02T00:00:00.000Z"),
          }),
        ],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: true,
      planKey: "free",
      state: "free",
    });
  });

  it("keeps Free active while a paid plan is scheduled for the future", () => {
    const result = normalizeBillingSubscription(
      subscription({
        items: [
          item({
            id: "subitem_paid",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            planSlug: "v1-workspace",
            status: "upcoming",
          }),
          item({
            id: "subitem_free",
            isDefault: true,
            planName: "Free",
            planSlug: "free",
          }),
        ],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: true,
      planKey: "free",
      state: "free",
    });
  });

  it.each(["past_due", "ended", "incomplete"] as const)(
    "fails closed for %s",
    (status) => {
      const result = normalizeBillingSubscription(
        subscription({
          status,
          items: [item({ planSlug: "v1-workspace", status })],
        }),
        { now, paidPlanSlug: "v1-workspace" },
      );

      expect(result.accessAllowed).toBe(false);
      expect(result.state).toBe(
        status === "past_due" ? "past_due" : "unavailable",
      );
    },
  );

  it("does not grant entitlements to an unknown non-default plan", () => {
    const result = normalizeBillingSubscription(
      subscription({
        items: [item({ planName: "Enterprise", planSlug: "enterprise" })],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(result).toMatchObject({
      accessAllowed: false,
      planKey: "unknown",
      state: "unavailable",
    });
  });
});

describe("resolveBillingRuntime", () => {
  it("is explicitly unmetered only outside production when disabled", () => {
    expect(
      resolveBillingRuntime({
        appEnv: "development",
        billingEnabled: false,
      }),
    ).toBe("unconfigured");
    expect(
      resolveBillingRuntime({
        appEnv: "production",
        billingEnabled: false,
      }),
    ).toBe("unavailable");
  });
});

describe("evaluateWorkspaceEntitlement", () => {
  const paid = normalizeBillingSubscription(
    subscription({
      items: [item({ planSlug: "v1-workspace" })],
    }),
    { now, paidPlanSlug: "v1-workspace" },
  );

  it("allows usage below the limit and blocks exactly at the limit", () => {
    expect(
      evaluateWorkspaceEntitlement({
        billing: paid,
        feature: "candidate_interviews",
        usage: workspacePlanCatalog.v1_workspace.candidateInterviewLimit - 1,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateWorkspaceEntitlement({
        billing: paid,
        feature: "candidate_interviews",
        usage: workspacePlanCatalog.v1_workspace.candidateInterviewLimit,
      }),
    ).toMatchObject({
      allowed: false,
      code: "usage_limit_reached",
    });
  });

  it("blocks recording when the plan does not include it", () => {
    const free = normalizeBillingSubscription(
      subscription({
        items: [item({ isDefault: true, planSlug: "free" })],
      }),
      { now, paidPlanSlug: "v1-workspace" },
    );

    expect(
      evaluateWorkspaceEntitlement({
        billing: free,
        feature: "recording",
        usage: 0,
      }),
    ).toMatchObject({
      allowed: false,
      code: "feature_not_in_plan",
    });
  });
});

describe("resolveBillingUsagePeriod", () => {
  it("uses the subscription period when both bounds are available", () => {
    expect(
      resolveBillingUsagePeriod(
        {
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      end: new Date("2026-08-01T00:00:00.000Z"),
      start: new Date("2026-07-01T00:00:00.000Z"),
    });
  });

  it("uses the current UTC month when Clerk supplies no period", () => {
    expect(
      resolveBillingUsagePeriod(
        { periodEnd: null, periodStart: null },
        now,
      ),
    ).toEqual({
      end: new Date("2026-08-01T00:00:00.000Z"),
      start: new Date("2026-07-01T00:00:00.000Z"),
    });
  });
});

function subscription(
  overrides: Partial<BillingSubscriptionSnapshot> = {},
): BillingSubscriptionSnapshot {
  return {
    id: "sub_123",
    items: [item()],
    status: "active",
    updatedAt: now,
    ...overrides,
  };
}

function item(
  overrides: Partial<BillingSubscriptionSnapshot["items"][number]> = {},
): BillingSubscriptionSnapshot["items"][number] {
  return {
    id: "subitem_123",
    isDefault: false,
    isFreeTrial: false,
    periodEnd: new Date("2026-08-24T10:00:00.000Z"),
    periodStart: new Date("2026-07-24T10:00:00.000Z"),
    planId: "cplan_v1",
    planName: "V1 Workspace",
    planSlug: "v1-workspace",
    status: "active",
    updatedAt: now,
    ...overrides,
  };
}
