import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { isCreditBillingEnabled } from "./credit-billing-flag";
import { ensureWallet, PAID_CREDIT_EXPIRY_DAYS } from "./credit-ledger";
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
      data: Array<{
        id: string;
        created: number;
        metadata: Stripe.Metadata | null;
        unit_amount: number | null;
        // NOT returned by default: Stripe omits `currency_options` from the Price
        // unless the request expands it (`expand[]=data.currency_options` on a
        // list). Absent here therefore means "not asked for" just as often as
        // "single-currency Price" — the reader below always asks.
        currency_options?: { [currency: string]: { unit_amount: number | null } } | null;
      }>;
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
 * A hosted Checkout session in `payment` mode always carries a redirect URL;
 * `null` means Stripe returned a shape this code cannot act on (an embedded
 * session), which is a wiring bug rather than a purchase outcome.
 */
export class MissingCheckoutSessionUrlError extends Error {
  constructor(readonly sessionId: string) {
    super(`Stripe Checkout session ${sessionId} came back without a redirect URL`);
    this.name = "MissingCheckoutSessionUrlError";
  }
}

/**
 * One Stripe Customer per organization, stored on the wallet.
 *
 * Two guards make concurrent callers converge on a single customer: the
 * `stripeCustomerId @unique` column, and Stripe's idempotency key derived from
 * the organization id — a replay inside the key's 24 h window returns the very
 * same customer instead of minting a duplicate that would split the billing
 * history in two. Two callers racing in-flight on the same key get one customer
 * and one retryable `idempotency_key_in_use` error, never two customers. The
 * only residue is an orphan: if the wallet write fails and the key has since
 * been pruned (24 h), the next call mints a second customer while the first is
 * referenced by nothing — no double billing, no split history, and it is
 * recoverable by hand, so we accept it rather than add a reservation dance.
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

  const pricing = await resolvePackPricing(db, stripe, {
    packId: pack.id,
    storedPriceId: pack.stripePriceId,
    storedProductId: pack.stripeProductId,
    cachedAmountCents: pack.unitAmountCents,
    cachedAmountCentsUsd: pack.unitAmountCentsUsd,
  });
  if (!pricing) {
    return { ok: false, error: "pack_not_purchasable" };
  }

  const { stripeCustomerId } = await ensureStripeCustomer(db, {
    organizationId,
    organizationName,
    now,
    stripe,
  });

  const baseUrl = origin.replace(/\/+$/, "");
  // Server-owned, never read back from the browser (amendment 3): fulfilment
  // cross-checks these against what Stripe says was actually paid before it
  // grants anything. Both currencies travel because Checkout — not this code —
  // decides which one the buyer pays (amendment 22): fulfilment picks the
  // comparison amount from `session.currency`, so a pack with no USD amount
  // sends no `amountCentsUsd` rather than a phantom one.
  const metadata: Record<string, string> = {
    organizationId,
    packId: pack.id,
    credits: String(pack.creditsGranted),
    amountCents: String(pricing.amountCents),
  };
  if (pricing.amountCentsUsd !== null) {
    metadata.amountCentsUsd = String(pricing.amountCentsUsd);
  }

  // go-live (amendment 21): once the CGV/ToS URL is configured in the Stripe
  // dashboard, add `consent_collection: { terms_of_service: "required" }` here —
  // Stripe errors on the parameter while no ToS URL is set, so it cannot ship yet.
  // `payment_intent_data.setup_future_usage` stays unset on purpose (amendment 10):
  // storing a card is the Phase 3 mandate flow, never a side effect of a purchase.
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [{ price: pricing.priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    // Amendment 15 — the balance is never a bare number, and neither is the
    // receipt. The invoice is the one artefact the buyer keeps and forwards to
    // their finance team, so the expiry travels on it: a customer who discovers
    // the 12-month clock only when credits vanish is a dispute we created.
    invoice_creation: {
      enabled: true,
      invoice_data: { description: creditInvoiceDescription(pack.creditsGranted, now) },
    },
    // Persist the tax address Checkout collects onto the Customer. The default
    // ("never") throws it away: the next purchase would re-collect it, and the
    // Customer that `invoice_creation` bills would stay address-less — which no
    // compliant French invoice can be (amendment 17).
    customer_update: { address: "auto" },
    client_reference_id: organizationId,
    metadata,
    // Amendment 6: the return is a route handler, never a page. It re-resolves
    // the caller's organization server-side and refuses a session that is not
    // theirs before fulfilment sees it — the `{CHECKOUT_SESSION_ID}` Stripe
    // substitutes here is indistinguishable, once in the address bar, from one a
    // recruiter typed. The handler then redirects to `/settings?purchase=…`, so
    // the session id never survives a reload.
    success_url: `${baseUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/settings?view=billing&purchase=cancelled`,
  });

  if (!session.url) {
    throw new MissingCheckoutSessionUrlError(session.id);
  }

  return { ok: true, url: session.url };
}

/**
 * The invoice line the customer keeps. Deliberately plain English and ISO-dated:
 * Stripe renders invoices in the account's language, this string is not
 * translated by anything downstream, and an unambiguous `YYYY-MM-DD` beats a
 * locale-formatted date that a French and a US buyer would read differently.
 *
 * The date is computed from `PAID_CREDIT_EXPIRY_DAYS` — the same constant the
 * ledger stamps onto the lot — so the promise on the invoice and the row in the
 * database can never drift apart.
 */
function creditInvoiceDescription(credits: number, now: Date): string {
  const expiresAt = new Date(now.getTime() + PAID_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const expiryDate = expiresAt.toISOString().slice(0, 10);
  return `${credits} HireCall interview credits — valid until ${expiryDate} (12 months from the purchase date).`;
}

type PackPricing = { priceId: string; amountCents: number; amountCentsUsd: number | null };

/**
 * Stripe is the price authority; `CreditPack.stripePriceId` is a cache that can
 * go stale — a teammate rotating a price against the shared test account
 * deactivates the Price other developers' databases still point at (amendment
 * 12). One `retrieve` per checkout tells us whether the cached id is still
 * live; only when it is not do we pay for the product-scoped lookup.
 *
 * The lookup is `prices.list` over the product rather than `prices.search`:
 * search is eventually consistent, and a price created seconds ago by the sync
 * script is exactly the one we need to find.
 *
 * The rotation branch writes back the whole cache, not just the corrected id: a
 * rotation is usually a price *change*, and shipping the stale amounts into the
 * session metadata would make fulfilment's cross-check (amendment 3) read a
 * legitimate payment as a divergence and park it in `needs_admin`. Writing what
 * Stripe just confirmed is the same discipline amendment 2 imposes on the sync
 * script — the cache follows Stripe, it never leads it. A Price that reports no
 * fixed `unit_amount` (tiered pricing) cannot refresh anything, so the cached
 * value stands.
 *
 * Returns `null` when the product has no active price carrying this pack id —
 * the catalogue promises something Stripe cannot sell.
 */
async function resolvePackPricing(
  db: PrismaClient,
  stripe: StripePurchaseClient,
  pack: {
    packId: string;
    storedPriceId: string;
    storedProductId: string | null;
    cachedAmountCents: number;
    cachedAmountCentsUsd: number | null;
  },
): Promise<PackPricing | null> {
  const stored = await stripe.prices.retrieve(pack.storedPriceId);
  if (stored.active) {
    return {
      priceId: stored.id,
      amountCents: pack.cachedAmountCents,
      amountCentsUsd: pack.cachedAmountCentsUsd,
    };
  }

  const productId =
    pack.storedProductId ?? (typeof stored.product === "string" ? stored.product : stored.product.id);
  const { data } = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
    // Without this the response carries no `currency_options` at all and the USD
    // refresh below would silently read nothing.
    expand: ["data.currency_options"],
  });
  // Mid-rotation the product can hold two active prices for the same pack (the
  // sync script creates the new one before deactivating the old): newest wins.
  const replacement = data
    .filter((price) => price.metadata?.packId === pack.packId)
    .sort((left, right) => right.created - left.created)[0];
  if (!replacement) {
    return null;
  }

  const refreshed: PackPricing = {
    priceId: replacement.id,
    amountCents: replacement.unit_amount ?? pack.cachedAmountCents,
    amountCentsUsd: replacement.currency_options?.usd?.unit_amount ?? pack.cachedAmountCentsUsd,
  };
  await db.creditPack.update({
    where: { id: pack.packId },
    data: {
      stripePriceId: refreshed.priceId,
      unitAmountCents: refreshed.amountCents,
      unitAmountCentsUsd: refreshed.amountCentsUsd,
    },
  });

  return refreshed;
}
