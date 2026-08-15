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
