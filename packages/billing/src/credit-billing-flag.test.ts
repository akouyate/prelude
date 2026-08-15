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

  // `"yes"` is here because `isEnabled()` in `server.ts` accepts it: an operator who
  // spells the kill switch the way the neighbouring flags are spelled must get the
  // switch they asked for, not a silently-off one.
  it.each(["1", "true", "TRUE ", "yes", " YES"])("is on for %j", (value) => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", value);
    expect(isCreditBillingEnabled()).toBe(true);
  });

  it.each(["0", "false", "no", "off"])("is off for %j", (value) => {
    vi.stubEnv("CREDIT_BILLING_ENABLED", value);
    expect(isCreditBillingEnabled()).toBe(false);
  });
});
