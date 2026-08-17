import Stripe from "stripe";

// The SDK pins its own API version; overriding it here would silently change
// webhook payload shapes on upgrade, so we deliberately do not pass one.
export class MissingStripeConfigError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY is not configured");
    this.name = "MissingStripeConfigError";
  }
}

export function isStripePurchaseConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_"));
}

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key?.startsWith("sk_")) throw new MissingStripeConfigError();
  return new Stripe(key);
}

export class MissingStripeWebhookSecretError extends Error {
  constructor() {
    super("STRIPE_WEBHOOK_SECRET is not configured");
    this.name = "MissingStripeWebhookSecretError";
  }
}

/**
 * Verifies a Stripe webhook signature and parses the event — amendment 7's whole
 * point: this is the only place the SDK is needed to receive a webhook, so the
 * console's route handler imports THIS and never `stripe` itself.
 *
 * `payload` must be the RAW request body (`await request.text()`). The signature
 * is an HMAC over those exact bytes, so anything that re-serialises the JSON —
 * `request.json()` above all — invalidates it.
 *
 * Uses the SDK's static `Stripe.webhooks` rather than a client instance:
 * verification is pure HMAC and deliberately does not depend on
 * `STRIPE_SECRET_KEY`. A misconfigured API key must not make signature
 * verification fail for the wrong reason, and the two secrets are configured
 * separately anyway — `STRIPE_WEBHOOK_SECRET` is local-per-developer
 * (amendment 12), the API key is shared.
 *
 * Throws on every unhappy path — an unset secret (`MissingStripeWebhookSecretError`),
 * an absent or malformed header, a bad signature, a stale timestamp — so the
 * caller needs exactly one `catch` to answer 400.
 */
export function constructStripeEvent(payload: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new MissingStripeWebhookSecretError();
  return Stripe.webhooks.constructEvent(payload, signature, secret);
}
