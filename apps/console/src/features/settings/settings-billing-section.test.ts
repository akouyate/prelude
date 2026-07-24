import { describe, expect, it } from "vitest";

import {
  billingStateDescriptionKey,
  usagePercentage,
} from "./settings-billing-helpers";

describe("billing usage meter calculations", () => {
  it("uses the real finite limit and clamps over-limit usage", () => {
    expect(usagePercentage(25, 100)).toBe(25);
    expect(usagePercentage(125, 100)).toBe(100);
  });

  it("does not invent a percentage for an unlimited entitlement", () => {
    expect(usagePercentage(125, null)).toBeNull();
  });

  it("handles a zero limit without producing an invalid number", () => {
    expect(usagePercentage(0, 0)).toBe(0);
    expect(usagePercentage(1, 0)).toBe(100);
  });
});

describe("billing state copy", () => {
  it("explains states that change product access", () => {
    expect(billingStateDescriptionKey("canceled")).toBe(
      "settings.billing.canceledDescription",
    );
    expect(billingStateDescriptionKey("past_due")).toBe(
      "settings.billing.pastDueDescription",
    );
    expect(billingStateDescriptionKey("unavailable")).toBe(
      "settings.billing.unavailableDescription",
    );
    expect(billingStateDescriptionKey("active")).toBe(
      "settings.billing.description",
    );
  });
});
