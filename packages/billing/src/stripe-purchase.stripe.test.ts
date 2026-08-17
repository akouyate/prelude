import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCreditCheckoutSession, ensureStripeCustomer } from "./stripe-purchase";

/**
 * The one test in this package that talks to Stripe for real.
 *
 * Everything else about the purchase path is proven against an injected fake
 * (`stripe-purchase.test.ts`) — fast, free, and offline. What a fake can never
 * prove is that the parameters we send are the ones Stripe accepts: that
 * `invoice_creation.invoice_data` is legal on this account, that
 * `customer_update.name` is what `tax_id_collection` demands, that a
 * `currency_options` price round-trips its `tax_behavior`, and that the
 * idempotency key really collapses two customer creations into one. Those are
 * contract facts owned by the API, so they are asserted against the API.
 *
 * Two gates, both by construction rather than by convention:
 *
 * 1. `sk_test_` prefix — a live-mode key (`sk_live_`) skips the suite instead of
 *    creating billable objects on the production account. An unset key skips too,
 *    so CI never pays for this file even though it matches the default
 *    `*.test.ts` glob.
 * 2. `TEST_DATABASE_URL` — the checkout path reads a `CreditPack` row and writes
 *    a `CreditWallet`, so it needs the throwaway Postgres, never a dev database.
 *
 * Every Stripe object created here is torn down in `afterAll`. "Torn down" means
 * deleted where Stripe allows it (customers) and archived where it does not
 * (prices are never deletable; a product that has ever carried a user-created
 * price is not either). Archiving is the real teardown for those: it removes
 * them from every purchasable surface, which is all the isolation this suite
 * needs.
 */
const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
const sandboxKey = secretKey?.startsWith("sk_test_") ? secretKey : undefined;
const databaseUrl = process.env.TEST_DATABASE_URL;

/**
 * The tax code the catalogue uses for credits — SaaS / cloud services. Pinned
 * here so the throwaway product is taxed the way a real pack is, which is what
 * makes `automatic_tax` behave identically in this session.
 */
const CREDIT_TAX_CODE = "txcd_10103001";

describe.skipIf(!sandboxKey || !databaseUrl)("Stripe purchase path (sandbox)", () => {
  const runId = `t10-${Date.now()}`;
  const packId = `smoke_${runId}`;

  let db: PrismaClient;
  let stripe: Stripe;
  let organizationId: string;
  let productId: string;
  let priceId: string;
  let customerId: string | undefined;

  const flagBefore = process.env.CREDIT_BILLING_ENABLED;

  beforeAll(async () => {
    // `createCreditCheckoutSession` refuses to build a session while the kill
    // switch is off. Restored in `afterAll` so this file cannot leak the flag
    // into a sibling suite.
    process.env.CREDIT_BILLING_ENABLED = "1";

    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    stripe = new Stripe(sandboxKey!);

    const product = await stripe.products.create({
      name: `HireCall smoke pack ${runId}`,
      tax_code: CREDIT_TAX_CODE,
      metadata: { packId, purpose: "task-10-live-smoke" },
    });
    productId = product.id;

    // 1 credit for 1,00 € — the smallest object that still exercises the real
    // shape of the catalogue: EUR base amount, USD riding along in
    // `currency_options`, `exclusive` tax behaviour on both so Stripe Tax adds
    // VAT on top rather than carving it out of the headline price.
    const price = await stripe.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: 100,
      tax_behavior: "exclusive",
      currency_options: { usd: { unit_amount: 120, tax_behavior: "exclusive" } },
      metadata: { packId },
    });
    priceId = price.id;

    const organization = await db.organization.create({
      data: { name: `Smoke org ${runId}` },
    });
    organizationId = organization.id;

    await db.creditPack.create({
      data: {
        id: packId,
        creditsGranted: 1,
        unitAmountCents: 100,
        unitAmountCentsUsd: 120,
        currency: "EUR",
        stripeProductId: product.id,
        stripePriceId: price.id,
        // `quiet` keeps the throwaway out of every pricing surface even in the
        // unlikely case a row survives cleanup.
        visibility: "quiet",
        enabled: true,
        displayOrder: 9999,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (flagBefore === undefined) {
      delete process.env.CREDIT_BILLING_ENABLED;
    } else {
      process.env.CREDIT_BILLING_ENABLED = flagBefore;
    }

    if (db) {
      // Children first: `CreditWallet.organizationId` is `onDelete: Restrict`.
      await db.creditLedgerEntry.deleteMany({ where: { organizationId } });
      await db.creditReservation.deleteMany({ where: { organizationId } });
      await db.creditLot.deleteMany({ where: { organizationId } });
      await db.creditWallet.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.creditPack.deleteMany({ where: { id: packId } });
      await db.$disconnect();
    }

    if (stripe) {
      if (priceId) await stripe.prices.update(priceId, { active: false });
      // Not `products.del`: Stripe answers "This product cannot be deleted
      // because it has one or more user-created prices" for any product that has
      // ever carried a price, archived or not. Archiving is the available
      // teardown and it is sufficient — an inactive product is unsellable.
      if (productId) await stripe.products.update(productId, { active: false });
      if (customerId) await stripe.customers.del(customerId);
    }
  }, 60_000);

  it("collapses two customer creations onto one Stripe customer via the idempotency key", async () => {
    const first = await ensureStripeCustomer(db, {
      organizationId,
      organizationName: `Smoke org ${runId}`,
      now: new Date(),
      stripe,
    });
    customerId = first.stripeCustomerId;
    expect(first.stripeCustomerId).toMatch(/^cus_/);

    // Simulates the one residue the doc comment on `ensureStripeCustomer`
    // admits: the customer exists at Stripe but the wallet write was lost.
    // Without the wallet cache the second call goes to Stripe for real — and
    // `idempotencyKey: customer:<organizationId>` is the only thing standing
    // between us and a duplicate that would split the billing history in two.
    await db.creditWallet.update({
      where: { organizationId },
      data: { stripeCustomerId: null },
    });

    const second = await ensureStripeCustomer(db, {
      organizationId,
      organizationName: `Smoke org ${runId}`,
      now: new Date(),
      stripe,
    });

    expect(second.stripeCustomerId).toBe(first.stripeCustomerId);
  }, 60_000);

  it("round-trips currency_options with exclusive tax behaviour on both currencies", async () => {
    // The go-live check from the catalogue sync: Stripe omits `currency_options`
    // unless the request expands it, so a reader that forgets `expand` sees
    // "no USD price" and a fallback kicks in silently.
    const price = await stripe.prices.retrieve(priceId, { expand: ["currency_options"] });

    expect(price.tax_behavior).toBe("exclusive");
    expect(price.unit_amount).toBe(100);
    expect(price.currency_options?.usd?.unit_amount).toBe(120);
    expect(price.currency_options?.usd?.tax_behavior).toBe("exclusive");
  }, 60_000);

  it("creates a hosted Checkout session Stripe actually accepts, with server-owned metadata", async () => {
    const now = new Date();
    const result = await createCreditCheckoutSession(db, {
      organizationId,
      organizationName: `Smoke org ${runId}`,
      packId,
      origin: "http://localhost:3000",
      now,
      stripe,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A real hosted page, not an embedded stub and not a fake's echo.
    expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);

    // The customer is throwaway and this is its only session, so the newest one
    // is unambiguously the one just created.
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 1,
    });
    const session = sessions.data[0];
    expect(session).toBeDefined();
    if (!session) return;
    expect(session.url).toBe(result.url);

    // Amendment 3 — fulfilment trusts none of this from the browser; it is here
    // because Stripe stored exactly what the server sent.
    expect(session.metadata).toMatchObject({
      organizationId,
      packId,
      credits: "1",
      amountCents: "100",
      amountCentsUsd: "120",
    });
    expect(session.client_reference_id).toBe(organizationId);
    expect(session.mode).toBe("payment");

    // Stripe Tax on, VAT number collectable, and the collected identity written
    // back onto the Customer the invoice will be issued to.
    expect(session.automatic_tax.enabled).toBe(true);
    expect(session.tax_id_collection?.enabled).toBe(true);

    // The parameter that only exists because Managed Payments is DISABLED: with
    // it enabled Stripe rejects the whole session, so this assertion is the
    // alarm for someone flipping that account setting back on.
    expect(session.invoice_creation?.enabled).toBe(true);
    expect(session.invoice_creation?.invoice_data?.description).toContain(
      "1 HireCall interview credits",
    );
    expect(session.invoice_creation?.invoice_data?.description).toContain("valid until");

    // Amendment 6 — the return is a route handler that re-resolves the caller's
    // organization server-side, never a page that trusts the session id.
    expect(session.success_url).toBe(
      "http://localhost:3000/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(session.cancel_url).toBe("http://localhost:3000/settings?view=billing&purchase=cancelled");

    // Nothing has been charged: the session is a link, and fulfilment only ever
    // runs off the webhook that says otherwise.
    expect(session.status).toBe("open");
    expect(session.payment_status).toBe("unpaid");
  }, 60_000);
});
