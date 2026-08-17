import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { InvalidCreditPurchaseAmountError, grantPurchasedCreditLot } from "./credit-ledger";
import {
  fulfillCreditCheckout,
  fulfillPaidPaymentIntent,
  type StripeFulfilmentClient,
} from "./stripe-fulfilment";

/**
 * The ledger is mocked, not faked: `grantPurchasedCreditLot` owns a wallet lock, a
 * three-write transaction and a scoped P2002 recovery, and any hand-rolled Prisma
 * stand-in for that would be exactly the lying fake this suite is meant to avoid.
 * Its behaviour is proven against a real database in `credit-ledger.db.test.ts`;
 * what these tests own is *what fulfilment decides to hand it, and whether it
 * hands it anything at all*.
 */
vi.mock("./credit-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credit-ledger")>();
  return { ...actual, grantPurchasedCreditLot: vi.fn() };
});

const grant = vi.mocked(grantPurchasedCreditLot);

const now = new Date("2026-08-15T09:00:00.000Z");

type PackRow = {
  id: string;
  creditsGranted: number;
  unitAmountCents: number;
  unitAmountCentsUsd: number | null;
  currency: string;
  enabled: boolean;
  visibility: string;
};

function pack(overrides: Partial<PackRow> = {}): PackRow {
  return {
    id: "hiring_100",
    creditsGranted: 100,
    unitAmountCents: 34900,
    unitAmountCentsUsd: 37900,
    currency: "EUR",
    enabled: true,
    visibility: "public",
    ...overrides,
  };
}

/**
 * Only `creditPack.findUnique` — with the grant mocked, fulfilment touches nothing
 * else. The undefined-filter throw mirrors Prisma: a `where: { id: undefined }`
 * raises rather than quietly matching the first row, so a session whose metadata
 * lost its `packId` cannot reach the database at all.
 */
function fakeDb(packs: PackRow[] = [pack()]) {
  const rows = new Map(packs.map((row) => [row.id, row]));
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
    if (typeof where.id !== "string") {
      throw new Error("Argument `id` is missing: Prisma refuses an undefined filter");
    }
    const row = rows.get(where.id);
    return row ? { ...row } : null;
  });

  return { db: { creditPack: { findUnique } } as unknown as PrismaClient, findUnique };
}

const paidMetadata = {
  organizationId: "org_1",
  packId: "hiring_100",
  credits: "100",
  amountCents: "34900",
  amountCentsUsd: "37900",
};

type SessionFixture = {
  id?: string;
  paymentStatus?: string;
  currency?: string | null;
  amountSubtotal?: number | null;
  amountTotal?: number | null;
  metadata?: Record<string, string> | null;
  paymentIntentId?: string | null;
  invoiceId?: string | null;
  /**
   * Serves `payment_intent` / `invoice` as bare ids even though the caller asked
   * for them expanded. Not a claim about `sessions.retrieve` — it is the shape
   * Stripe puts in a webhook payload (event payloads are never expanded) and the
   * shape the SDK types keep (`string | PaymentIntent | null`) whatever we
   * request, so the narrowing in the reader has to be real rather than decorative.
   */
  unexpanded?: boolean;
};

function fakeStripe(fixture: SessionFixture = {}) {
  const {
    id = "cs_1",
    paymentStatus = "paid",
    currency = "eur",
    amountSubtotal = 34900,
    // Checkout adds Stripe Tax on top of the subtotal and takes discounts off it,
    // so the two differ on every real session: a cross-check reading
    // `amount_total` cannot pass here, and a fully discounted session can be
    // fixtured honestly (subtotal intact, total zero).
    amountTotal = amountSubtotal === null ? null : Math.round(amountSubtotal * 1.2),
    metadata = paidMetadata,
    paymentIntentId = "pi_1",
    invoiceId = "in_1",
    unexpanded = false,
  } = fixture;

  const retrieve = vi.fn(async (_id: string, params?: Stripe.Checkout.SessionRetrieveParams) => {
    const expanded = new Set(params?.expand ?? []);
    // Honest to the API: an expandable field comes back as a bare id string
    // unless the caller expanded it. A fake that always returns the object would
    // hide a reader that never handles the id form.
    const link = (field: string, value: string | null) => {
      if (value === null) return null;
      return !unexpanded && expanded.has(field) ? { id: value, object: field } : value;
    };

    return {
      id,
      payment_status: paymentStatus,
      currency,
      amount_subtotal: amountSubtotal,
      amount_total: amountTotal,
      metadata,
      payment_intent: link("payment_intent", paymentIntentId),
      invoice: link("invoice", invoiceId),
    };
  });

  const stripe: StripeFulfilmentClient = { checkout: { sessions: { retrieve } } };
  return { stripe, retrieve };
}

beforeEach(() => {
  grant.mockReset();
  grant.mockResolvedValue({ outcome: "granted", lotId: "lot_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fulfillPaidPaymentIntent", () => {
  it("hands a settled payment straight to the ledger", async () => {
    const { db } = fakeDb();

    const result = await fulfillPaidPaymentIntent(db, {
      organizationId: "org_1",
      packId: "hiring_100",
      creditsGranted: 100,
      unitAmountCents: 34900,
      currency: "eur",
      stripePaymentIntentId: "pi_1",
      stripeEventId: "evt_1",
      now,
    });

    expect(result).toEqual({ outcome: "granted", lotId: "lot_1" });
    expect(grant).toHaveBeenCalledWith(db, {
      organizationId: "org_1",
      packId: "hiring_100",
      creditsGranted: 100,
      unitAmountCents: 34900,
      currency: "eur",
      stripePaymentIntentId: "pi_1",
      stripeEventId: "evt_1",
      now,
    });
  });

  it("passes a duplicate payment through as already_granted", async () => {
    grant.mockResolvedValue({ outcome: "already_granted" });
    const { db } = fakeDb();

    await expect(
      fulfillPaidPaymentIntent(db, {
        organizationId: "org_1",
        packId: "hiring_100",
        creditsGranted: 100,
        unitAmountCents: 34900,
        currency: "eur",
        stripePaymentIntentId: "pi_1",
        now,
      }),
    ).resolves.toEqual({ outcome: "already_granted" });
  });

  it("does not swallow the ledger's positivity guard", async () => {
    grant.mockRejectedValue(new InvalidCreditPurchaseAmountError("org_1", 0, 34900));
    const { db } = fakeDb();

    await expect(
      fulfillPaidPaymentIntent(db, {
        organizationId: "org_1",
        packId: "hiring_100",
        creditsGranted: 0,
        unitAmountCents: 34900,
        currency: "eur",
        stripePaymentIntentId: "pi_1",
        now,
      }),
    ).rejects.toBeInstanceOf(InvalidCreditPurchaseAmountError);
  });

  it("passes a currency mismatch through untouched", async () => {
    grant.mockResolvedValue({
      outcome: "currency_mismatch",
      walletCurrency: "EUR",
      sessionCurrency: "USD",
    });
    const { db } = fakeDb();

    await expect(
      fulfillPaidPaymentIntent(db, {
        organizationId: "org_1",
        packId: "hiring_100",
        creditsGranted: 100,
        unitAmountCents: 37900,
        currency: "usd",
        stripePaymentIntentId: "pi_1",
        now,
      }),
    ).resolves.toEqual({
      outcome: "currency_mismatch",
      walletCurrency: "EUR",
      sessionCurrency: "USD",
    });
  });
});

describe("fulfillCreditCheckout", () => {
  it("re-reads the session, validates the pack server-side, and grants once", async () => {
    const { db } = fakeDb();
    const { stripe, retrieve } = fakeStripe();

    const result = await fulfillCreditCheckout(db, {
      checkoutSessionId: "cs_1",
      stripeEventId: "evt_1",
      now,
      stripe,
    });

    expect(retrieve).toHaveBeenCalledWith("cs_1", { expand: ["payment_intent", "invoice"] });
    expect(result).toEqual({ outcome: "granted", lotId: "lot_1" });
    expect(grant).toHaveBeenCalledWith(db, {
      organizationId: "org_1",
      packId: "hiring_100",
      // The catalogue's number, not `metadata.credits` — cross-check 1 is what
      // makes the two identical, and credits are our definition, not Stripe's.
      creditsGranted: 100,
      unitAmountCents: 34900,
      currency: "eur",
      stripePaymentIntentId: "pi_1",
      stripeCheckoutSessionId: "cs_1",
      stripeInvoiceId: "in_1",
      stripeEventId: "evt_1",
      now,
    });
  });

  it("records the amount the customer paid, not the catalogue's current price", async () => {
    // The price rotated after this session was created: the catalogue now says
    // €399 while the customer was charged €349 and the metadata still proves it.
    const { db } = fakeDb([pack({ unitAmountCents: 39900, unitAmountCentsUsd: 42900 })]);
    const { stripe } = fakeStripe();

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "granted",
      lotId: "lot_1",
    });
    expect(grant).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ unitAmountCents: 34900, currency: "eur" }),
    );
  });

  it("extracts the payment intent id when Stripe reports it unexpanded", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ unexpanded: true });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "granted",
      lotId: "lot_1",
    });
    expect(grant).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ stripePaymentIntentId: "pi_1", stripeInvoiceId: "in_1" }),
    );
  });

  it("refuses to grant while payment_status is unpaid (deferred methods)", async () => {
    const { db, findUnique } = fakeDb();
    const { stripe } = fakeStripe({ paymentStatus: "unpaid" });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "not_paid",
    });
    expect(grant).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["a fully discounted session that collected nothing", "no_payment_required"],
    ["a payment status this code has never seen", "pending_review"],
  ])("refuses to grant on %s", async (_label, paymentStatus) => {
    const { db, findUnique } = fakeDb();
    // `amount_subtotal` is the total BEFORE discounts (SDK: "Total of all items
    // before discounts or taxes are applied"), so it matches the metadata to the
    // cent while `amount_total` is zero and the customer paid nothing. The amount
    // cross-check cannot see this — only a paid-only guard can.
    const { stripe } = fakeStripe({ paymentStatus, amountSubtotal: 34900, amountTotal: 0 });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "needs_admin",
      reason: "no_payment_required",
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it("parks a catalogue row that would grant no credits at all", async () => {
    const { db } = fakeDb([pack({ creditsGranted: 0 })]);
    // The metadata agrees with the corrupt row, so the credits cross-check waves
    // it straight through: without a floor on the pack itself this reaches the
    // ledger's positivity guard, throws, archives `failed`, and Stripe retries a
    // payment that can never succeed. It has to park instead.
    const { stripe } = fakeStripe({ metadata: { ...paidMetadata, credits: "0" } });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "unknown_pack",
    });
    expect(grant).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("does not swallow the ledger's positivity guard", async () => {
    // True by construction today — the grant is a tail call. The test is here so
    // that a future defensive `catch` around it cannot land unnoticed and turn a
    // refused grant into a silent success.
    grant.mockRejectedValue(new InvalidCreditPurchaseAmountError("org_1", 100, -1));
    const { db } = fakeDb();
    const { stripe } = fakeStripe();

    await expect(
      fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe }),
    ).rejects.toBeInstanceOf(InvalidCreditPurchaseAmountError);
  });

  it("maps a duplicate delivery to already_granted", async () => {
    grant.mockResolvedValue({ outcome: "already_granted" });
    const { db } = fakeDb();
    const { stripe } = fakeStripe();

    await expect(
      fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", stripeEventId: "evt_2", now, stripe }),
    ).resolves.toEqual({ outcome: "already_granted" });
  });

  it("flags a session whose packId no longer exists", async () => {
    const { db } = fakeDb([pack({ id: "hiring_500" })]);
    const { stripe } = fakeStripe();

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "unknown_pack",
    });
    expect(grant).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("flags a session whose pack has since been disabled", async () => {
    const { db } = fakeDb([pack({ enabled: false })]);
    const { stripe } = fakeStripe();

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "unknown_pack",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it.each([
    ["no organizationId", { packId: "hiring_100", credits: "100", amountCents: "34900" }],
    ["a blank organizationId", { ...paidMetadata, organizationId: "   " }],
    ["no packId", { organizationId: "org_1", credits: "100", amountCents: "34900" }],
    ["no metadata at all", null],
  ])("parks a session with %s for an admin", async (_label, metadata) => {
    const { db, findUnique } = fakeDb();
    const { stripe } = fakeStripe({ metadata });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "needs_admin",
      reason: "missing_metadata",
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
  });

  it("refuses when the credits in the metadata diverge from the catalogue", async () => {
    const { db } = fakeDb([pack({ creditsGranted: 150 })]);
    const { stripe } = fakeStripe();

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "amount_mismatch",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("refuses when the EUR subtotal diverges from the metadata amount", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ amountSubtotal: 30000 });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "amount_mismatch",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("refuses when Stripe reports no subtotal at all", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ amountSubtotal: null });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "amount_mismatch",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("checks a USD session against the USD metadata amount and records USD", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ currency: "usd", amountSubtotal: 37900 });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "granted",
      lotId: "lot_1",
    });
    expect(grant).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ unitAmountCents: 37900, currency: "usd", creditsGranted: 100 }),
    );
  });

  it("refuses a USD session whose metadata carries no USD amount", async () => {
    const { db } = fakeDb();
    const { amountCentsUsd: _absent, ...withoutUsd } = paidMetadata;
    const { stripe } = fakeStripe({ currency: "usd", amountSubtotal: 37900, metadata: withoutUsd });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "amount_mismatch",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("refuses a session settled in a currency we never sell in", async () => {
    const { db } = fakeDb();
    // A GBP subtotal that happens to equal the EUR metadata amount: only the
    // currency check can catch this one.
    const { stripe } = fakeStripe({ currency: "gbp", amountSubtotal: 34900 });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "amount_mismatch",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("reports no_payment_intent when the session carries none", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ paymentIntentId: null });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "no_payment_intent",
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it("grants without an invoice id when the session has no invoice", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ invoiceId: null });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "granted",
      lotId: "lot_1",
    });
    expect(grant).toHaveBeenCalledWith(db, expect.objectContaining({ stripeInvoiceId: undefined }));
  });

  it("maps a currency mismatch to a parked outcome and logs the wallet/session currencies", async () => {
    grant.mockResolvedValue({
      outcome: "currency_mismatch",
      walletCurrency: "EUR",
      sessionCurrency: "USD",
    });
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ currency: "usd", amountSubtotal: 37900 });

    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "currency_mismatch",
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        checkoutSessionId: "cs_1",
        organizationId: "org_1",
        walletCurrency: "EUR",
        sessionCurrency: "USD",
      }),
    );
  });
});

/**
 * Amendment 6. The browser-return route hands this function a `cs_…` taken
 * straight out of a query string — attacker input. Without an ownership check the
 * route answers differently for "a session that exists and belongs to someone
 * else" than for "a session that does not exist", which turns it into an
 * enumeration oracle over other organizations' checkouts (and, worse, fulfils
 * them). `expectedOrganizationId` puts that check inside the money boundary
 * rather than leaving it to each caller's discipline.
 *
 * The webhook and the sweep pass NO expected organization: they are authenticated
 * by Stripe's signature, not by a session, and must keep parking anomalies in
 * `needs_admin` rather than silently answering `foreign_session`.
 */
describe("fulfillCreditCheckout ownership guard", () => {
  it("refuses a session belonging to another organization without reading the catalogue or the ledger", async () => {
    const { db, findUnique } = fakeDb();
    const { stripe } = fakeStripe();

    await expect(
      fulfillCreditCheckout(db, {
        checkoutSessionId: "cs_1",
        expectedOrganizationId: "org_intruder",
        now,
        stripe,
      }),
    ).resolves.toEqual({ outcome: "foreign_session" });
    expect(grant).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("answers foreign_session for an UNPAID foreign session too, so the outcome leaks nothing about it", async () => {
    // The refusal has to land before the payment-status branch: a caller who can
    // tell "someone else's paid session" from "someone else's unpaid session" can
    // still read other organizations' checkout state one bit at a time.
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ paymentStatus: "unpaid" });

    await expect(
      fulfillCreditCheckout(db, {
        checkoutSessionId: "cs_1",
        expectedOrganizationId: "org_intruder",
        now,
        stripe,
      }),
    ).resolves.toEqual({ outcome: "foreign_session" });
    expect(grant).not.toHaveBeenCalled();
  });

  it("answers foreign_session — not needs_admin — for a session with no owner in its metadata", async () => {
    // Same single answer for "not ours" whatever the reason. `needs_admin` here
    // would tell the caller the session exists and is one we could not attribute.
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ metadata: null });

    await expect(
      fulfillCreditCheckout(db, {
        checkoutSessionId: "cs_1",
        expectedOrganizationId: "org_1",
        now,
        stripe,
      }),
    ).resolves.toEqual({ outcome: "foreign_session" });
    expect(grant).not.toHaveBeenCalled();
  });

  it("fulfils normally when the expected organization is the session's own", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe();

    await expect(
      fulfillCreditCheckout(db, {
        checkoutSessionId: "cs_1",
        expectedOrganizationId: "org_1",
        now,
        stripe,
      }),
    ).resolves.toEqual({ outcome: "granted", lotId: "lot_1" });
    expect(grant).toHaveBeenCalledWith(db, expect.objectContaining({ organizationId: "org_1" }));
  });

  it("keeps the webhook path untouched: no expected organization means no ownership refusal", async () => {
    const { db } = fakeDb();
    const { stripe } = fakeStripe({ metadata: null });

    // Unattributable via the signed webhook is still a human's problem, not a
    // "not yours" — the archive must keep parking it.
    await expect(fulfillCreditCheckout(db, { checkoutSessionId: "cs_1", now, stripe })).resolves.toEqual({
      outcome: "needs_admin",
      reason: "missing_metadata",
    });
  });
});
