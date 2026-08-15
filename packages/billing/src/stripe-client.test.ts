import { afterEach, describe, expect, it, vi } from "vitest";

import { getStripeClient, isStripePurchaseConfigured, MissingStripeConfigError } from "./stripe-client";

afterEach(() => vi.unstubAllEnvs());

describe("stripe client", () => {
  it("reports unconfigured without a secret key and refuses to build a client", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(isStripePurchaseConfigured()).toBe(false);
    expect(() => getStripeClient()).toThrow(MissingStripeConfigError);
  });

  it("rejects a key that is not a secret key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_test_not_a_secret");
    expect(isStripePurchaseConfigured()).toBe(false);
  });

  it("builds a client from a secret key without calling the network", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    expect(isStripePurchaseConfigured()).toBe(true);
    expect(getStripeClient()).toBeDefined();
  });
});
