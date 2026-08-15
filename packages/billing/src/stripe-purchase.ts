import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { isCreditBillingEnabled } from "./credit-billing-flag";
import { ensureWallet } from "./credit-ledger";
import { getStripeClient, isStripePurchaseConfigured } from "./stripe-client";

/**
 * The slice of the Stripe SDK this module touches. Narrowing the dependency to a
 * structural port is what lets the tests inject a fake without a network call and
 * without casting a whole `Stripe` instance; the real client satisfies it as-is.
 */
export type StripePurchaseClient = {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
  };
  prices: {
    retrieve(id: string): Promise<{
      id: string;
      active: boolean;
      product: string | { id: string };
    }>;
    list(params: Stripe.PriceListParams): Promise<{
      data: Array<{ id: string; metadata: Stripe.Metadata | null }>;
    }>;
  };
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
};

export type CreditCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: "unknown_pack" | "pack_not_purchasable" | "not_configured" };

/**
 * Closed set (amendment 22): EUR is the default and USD rides along as a
 * `currency_options` entry on the same Stripe Price. Anything else in the
 * catalogue is a configuration mistake, not a customer-facing outcome — Stripe
 * Tax, the invoice mentions and the reporting conversions are all built for
 * these two only, so we refuse loudly rather than sell in a currency the rest
 * of the pipeline cannot account for.
 */
export const SUPPORTED_CREDIT_CURRENCIES = ["EUR", "USD"] as const;

export class UnsupportedCreditCurrencyError extends Error {
  constructor(
    readonly packId: string,
    readonly currency: string,
  ) {
    super(
      `Credit pack ${packId} is priced in ${currency}; supported currencies are ${SUPPORTED_CREDIT_CURRENCIES.join(", ")}`,
    );
    this.name = "UnsupportedCreditCurrencyError";
  }
}

/**
 * One Stripe Customer per organization, stored on the wallet.
 *
 * Two guards make concurrent callers converge on a single customer: the
 * `stripeCustomerId @unique` column, and Stripe's idempotency key derived from
 * the organization id — a replay inside the key's 24 h window returns the very
 * same customer instead of minting a duplicate that would split the billing
 * history in two.
 */
export async function ensureStripeCustomer(
  db: PrismaClient,
  input: {
    organizationId: string;
    organizationName: string;
    now: Date;
    stripe?: StripePurchaseClient;
  },
): Promise<{ stripeCustomerId: string }> {
  const { organizationId, organizationName, now, stripe = getStripeClient() } = input;

  const { walletId } = await ensureWallet(db, { organizationId, now });
  const wallet = await db.creditWallet.findUniqueOrThrow({ where: { id: walletId } });
  if (wallet.stripeCustomerId) {
    return { stripeCustomerId: wallet.stripeCustomerId };
  }

  const customer = await stripe.customers.create(
    { name: organizationName, metadata: { organizationId } },
    { idempotencyKey: `customer:${organizationId}` },
  );
  await db.creditWallet.update({
    where: { id: walletId },
    data: { stripeCustomerId: customer.id },
  });

  return { stripeCustomerId: customer.id };
}

/**
 * Turns a catalogue pack into a hosted Checkout session.
 *
 * The three `ok: false` outcomes are recruiter-facing states the UI can render;
 * a catalogue priced outside {EUR, USD} throws instead, because that is our
 * misconfiguration and no message to the buyer would make it actionable.
 */
export async function createCreditCheckoutSession(
  db: PrismaClient,
  input: {
    organizationId: string;
    organizationName: string;
    packId: string;
    origin: string;
    now: Date;
    stripe?: StripePurchaseClient;
  },
): Promise<CreditCheckoutResult> {
  const { organizationId, organizationName, packId, origin, now } = input;

  if (!isCreditBillingEnabled() || !isStripePurchaseConfigured()) {
    return { ok: false, error: "not_configured" };
  }
  const stripe = input.stripe ?? getStripeClient();

  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack) {
    return { ok: false, error: "unknown_pack" };
  }
  // `visibility` gates the pricing surfaces only (#139): a `quiet` pack is
  // bought through a direct link and must stay purchasable here.
  if (!pack.enabled || !pack.stripePriceId) {
    return { ok: false, error: "pack_not_purchasable" };
  }

  const currency = pack.currency.trim().toUpperCase();
  if (!SUPPORTED_CREDIT_CURRENCIES.some((supported) => supported === currency)) {
    throw new UnsupportedCreditCurrencyError(pack.id, pack.currency);
  }

  const priceId = await resolveActivePriceId(db, stripe, {
    packId: pack.id,
    storedPriceId: pack.stripePriceId,
    storedProductId: pack.stripeProductId,
  });
  if (!priceId) {
    return { ok: false, error: "pack_not_purchasable" };
  }

  const { stripeCustomerId } = await ensureStripeCustomer(db, {
    organizationId,
    organizationName,
    now,
    stripe,
  });

  const baseUrl = origin.replace(/\/+$/, "");
  // go-live (amendment 21): once the CGV/ToS URL is configured in the Stripe
  // dashboard, add `consent_collection: { terms_of_service: "required" }` here —
  // Stripe errors on the parameter while no ToS URL is set, so it cannot ship yet.
  // `payment_intent_data.setup_future_usage` stays unset on purpose (amendment 10):
  // storing a card is the Phase 3 mandate flow, never a side effect of a purchase.
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    invoice_creation: { enabled: true },
    client_reference_id: organizationId,
    // Server-owned, never read back from the browser (amendment 3): fulfilment
    // cross-checks these against what Stripe says was actually paid before it
    // grants anything. `amountCents` is the catalogue's EUR reference amount —
    // a USD buyer pays the Price's USD option, which is why the check at
    // fulfilment is currency-aware rather than a bare equality.
    metadata: {
      organizationId,
      packId: pack.id,
      credits: String(pack.creditsGranted),
      amountCents: String(pack.unitAmountCents),
    },
    success_url: `${baseUrl}/settings?credit_checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/settings?credit_checkout=cancelled`,
  });

  if (!session.url) {
    throw new Error(`Stripe Checkout session ${session.id} came back without a redirect URL`);
  }

  return { ok: true, url: session.url };
}

/**
 * Stripe is the price authority; `CreditPack.stripePriceId` is a cache that can
 * go stale — a teammate rotating a price against the shared test account
 * deactivates the Price other developers' databases still point at (amendment
 * 12). One `retrieve` per checkout tells us whether the cached id is still
 * live; only when it is not do we pay for the product-scoped lookup, and the
 * corrected id is written back so the next checkout is a single call again.
 *
 * The lookup is `prices.list` over the product rather than `prices.search`:
 * search is eventually consistent, and a price created seconds ago by the sync
 * script is exactly the one we need to find.
 *
 * Returns `null` when the product has no active price carrying this pack id —
 * the catalogue promises something Stripe cannot sell.
 */
async function resolveActivePriceId(
  db: PrismaClient,
  stripe: StripePurchaseClient,
  pack: { packId: string; storedPriceId: string; storedProductId: string | null },
): Promise<string | null> {
  const stored = await stripe.prices.retrieve(pack.storedPriceId);
  if (stored.active) {
    return stored.id;
  }

  const productId =
    pack.storedProductId ?? (typeof stored.product === "string" ? stored.product : stored.product.id);
  const { data } = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const replacement = data.find((price) => price.metadata?.packId === pack.packId);
  if (!replacement) {
    return null;
  }

  await db.creditPack.update({
    where: { id: pack.packId },
    data: { stripePriceId: replacement.id },
  });

  return replacement.id;
}
