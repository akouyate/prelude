import { describe, expect, it } from "vitest";

import { mapClerkBillingSubscription } from "./clerk-billing";

describe("mapClerkBillingSubscription", () => {
  it("maps only the canonical subscription fields needed by the billing policy", () => {
    const result = mapClerkBillingSubscription({
      id: "sub_123",
      status: "active",
      subscriptionItems: [
        {
          id: "subitem_123",
          status: "active",
          plan: {
            id: "plan_v1",
            isDefault: false,
            name: "V1 Workspace",
            slug: "v1-workspace",
          },
          planId: "plan_v1",
          periodEnd: 1780272000000,
          periodStart: 1751328000000,
          isFreeTrial: true,
          updatedAt: 1751414400000,
        },
      ],
      updatedAt: 1751328000000,
    });

    expect(result).toEqual({
      id: "sub_123",
      status: "active",
      updatedAt: new Date("2025-07-01T00:00:00.000Z"),
      items: [
        {
          id: "subitem_123",
          status: "active",
          isDefault: false,
          isFreeTrial: true,
          periodStart: new Date("2025-07-01T00:00:00.000Z"),
          periodEnd: new Date("2026-06-01T00:00:00.000Z"),
          planId: "plan_v1",
          planName: "V1 Workspace",
          planSlug: "v1-workspace",
          updatedAt: new Date("2025-07-02T00:00:00.000Z"),
        },
      ],
    });
  });
});
