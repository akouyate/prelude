import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  constructStripeEvent,
  getStripeClient,
  isStripePurchaseConfigured,
  MissingStripeConfigError,
  MissingStripeWebhookSecretError,
} from "./stripe-client";

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

/**
 * Amendment 7 — the Stripe SDK never crosses into the console. Verification is
 * the one place the console would otherwise have to import `stripe`, so it lives
 * here, behind a named function.
 *
 * The signatures below are produced by the REAL SDK
 * (`generateTestHeaderString` is what Stripe ships for exactly this), so these
 * are genuine HMAC round-trips — no Stripe account, no network, no fake crypto.
 */
describe("constructStripeEvent", () => {
  const payload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", object: "checkout.session" } },
  });
  const stripe = new Stripe("sk_test_dummy");

  function sign(body: string, secret = "whsec_test") {
    return stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  }

  it("parses an authentic payload into an event", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

    const event = constructStripeEvent(payload, sign(payload));

    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects a payload whose body was tampered with after signing", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const header = sign(payload);
    const tampered = payload.replace("cs_1", "cs_attacker");

    expect(() => constructStripeEvent(tampered, header)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  it("rejects a signature produced with a different secret", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

    expect(() => constructStripeEvent(payload, sign(payload, "whsec_someone_else"))).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  it("rejects a missing signature header rather than trusting the body", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

    expect(() => constructStripeEvent(payload, "")).toThrow();
  });

  it("names the misconfiguration when the webhook secret is unset", () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    expect(() => constructStripeEvent(payload, sign(payload))).toThrow(
      MissingStripeWebhookSecretError,
    );
  });

  /**
   * Verification is pure HMAC over the raw body: it has nothing to do with the
   * API key, and coupling the two would make a webhook endpoint fail for the
   * wrong reason. `STRIPE_WEBHOOK_SECRET` is also local-per-developer
   * (amendment 12) while `STRIPE_SECRET_KEY` is shared, so they genuinely are
   * two independent configurations.
   */
  it("does not need STRIPE_SECRET_KEY to verify a signature", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");

    expect(constructStripeEvent(payload, sign(payload)).id).toBe("evt_1");
  });
});
