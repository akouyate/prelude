import { afterEach, describe, expect, it, vi } from "vitest";

import { isCreditBillingEnabled } from "./credit-billing-flag";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCreditBillingEnabled", () => {
  it("is off when unset", () => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", undefined);
    expect(isCreditBillingEnabled()).toBe(false);
  });

  it.each(["1", "true", "TRUE "])("is on for %j", (value) => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", value);
    expect(isCreditBillingEnabled()).toBe(true);
  });

  it.each(["0", "false"])("is off for %j", (value) => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", value);
    expect(isCreditBillingEnabled()).toBe(false);
  });
});
