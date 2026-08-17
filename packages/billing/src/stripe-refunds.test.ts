import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import {
  freezeLotForDispute,
  resolveDisputeOnLot,
  revokeUnconsumedLot,
} from "./credit-ledger";
import {
  handleDisputeEvent,
  handleRefundEvent,
  type StripeRefundClient,
} from "./stripe-refunds";

/**
 * Same discipline as `stripe-fulfilment.test.ts`: the three ledger functions are
 * MOCKED, not faked. Each owns a wallet row lock, a status-guarded transition and
 * a multi-write transaction, and a hand-rolled Prisma stand-in for that would be
 * precisely the lying fake these suites exist to avoid. Their behaviour is proven
 * against a real Postgres in `credit-ledger.db.test.ts`; what this file owns is
 * *what the routing decides to hand them, and whether it hands them anything at
 * all* — including that it re-reads the object from the API first.
 */
vi.mock("./credit-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credit-ledger")>();
  return {
    ...actual,
    freezeLotForDispute: vi.fn(),
    resolveDisputeOnLot: vi.fn(),
    revokeUnconsumedLot: vi.fn(),
  };
});

const freeze = vi.mocked(freezeLotForDispute);
const resolve = vi.mocked(resolveDisputeOnLot);
const revoke = vi.mocked(revokeUnconsumedLot);

const now = new Date("2026-08-15T09:00:00.000Z");
const db = {} as PrismaClient;

type RefundFixture = {
  id?: string;
  amount?: number;
  chargeId?: string | null;
  paymentIntentId?: string | null;
};

type ChargeFixture = {
  id?: string;
  amount?: number;
  amountRefunded?: number;
  paymentIntentId?: string | null;
};

type DisputeFixture = {
  id?: string;
  status?: string;
  chargeId?: string | null;
  paymentIntentId?: string | null;
};

/**
 * An honest slice of the API. Two properties matter and are deliberately not
 * softened:
 *
 * - expandable fields come back as BARE IDS unless the caller expanded them,
 *   which is the shape a webhook payload always carries — a fake that always
 *   returned objects would hide a reader that never narrows the id form;
 * - every `retrieve` records its calls, so a handler that trusted the delivered
 *   payload instead of re-reading it (payloads are eventually consistent) fails
 *   here rather than in production.
 */
function fakeStripe(
  fixtures: {
    refund?: RefundFixture;
    charge?: ChargeFixture;
    dispute?: DisputeFixture;
  } = {},
) {
  const refund = {
    id: "re_1",
    amount: 9900,
    chargeId: "ch_1",
    paymentIntentId: "pi_1",
    ...fixtures.refund,
  };
  const charge = {
    id: "ch_1",
    amount: 11880,
    amountRefunded: 11880,
    paymentIntentId: "pi_1",
    ...fixtures.charge,
  };
  const dispute = {
    id: "dp_1",
    status: "needs_response",
    chargeId: "ch_1",
    paymentIntentId: "pi_1",
    ...fixtures.dispute,
  };

  const retrieveRefund = vi.fn(async (id: string) => ({
    id,
    object: "refund" as const,
    amount: refund.amount,
    charge: refund.chargeId,
    payment_intent: refund.paymentIntentId,
    status: "succeeded",
  }));
  const retrieveCharge = vi.fn(async (id: string) => ({
    id,
    object: "charge" as const,
    amount: charge.amount,
    amount_refunded: charge.amountRefunded,
    refunded: charge.amountRefunded >= charge.amount,
    payment_intent: charge.paymentIntentId,
  }));
  const retrieveDispute = vi.fn(async (id: string) => ({
    id,
    object: "dispute" as const,
    status: dispute.status,
    charge: dispute.chargeId,
    payment_intent: dispute.paymentIntentId,
  }));

  const stripe: StripeRefundClient = {
    refunds: { retrieve: retrieveRefund },
    charges: { retrieve: retrieveCharge },
    disputes: { retrieve: retrieveDispute },
  };
  return { stripe, retrieveRefund, retrieveCharge, retrieveDispute };
}

/**
 * The envelope Stripe posts. The delivered object carries STALE figures on
 * purpose (`amount: 1` on the refund, `lost` on a dispute that is still open),
 * so any handler that read the payload instead of re-retrieving would produce a
 * visibly wrong call.
 */
function stripeEvent(type: string, object: Record<string, unknown>): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: "event",
    api_version: "2026-07-30.clover",
    created: 1_755_248_400,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

const refundCreated = stripeEvent("refund.created", {
  id: "re_1",
  object: "refund",
  amount: 1,
  charge: "ch_stale",
});
const chargeRefunded = stripeEvent("charge.refunded", {
  id: "ch_1",
  object: "charge",
  amount: 1,
  amount_refunded: 1,
});
const disputeCreated = stripeEvent("charge.dispute.created", {
  id: "dp_1",
  object: "dispute",
  status: "lost",
});
const disputeClosed = stripeEvent("charge.dispute.closed", {
  id: "dp_1",
  object: "dispute",
  status: "needs_response",
});

beforeEach(() => {
  freeze.mockReset();
  resolve.mockReset();
  revoke.mockReset();
  freeze.mockResolvedValue({
    outcome: "applied",
    organizationId: "org_1",
    lotId: "lot_1",
    credits: 24,
  });
  resolve.mockResolvedValue({
    outcome: "applied",
    organizationId: "org_1",
    lotId: "lot_1",
    credits: 24,
  });
  revoke.mockResolvedValue({
    outcome: "applied",
    organizationId: "org_1",
    lotId: "lot_1",
    credits: 25,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleRefundEvent", () => {
  it("re-reads the refund and its charge before revoking anything", async () => {
    const { stripe, retrieveRefund, retrieveCharge } = fakeStripe();

    const status = await handleRefundEvent(db, refundCreated, { stripe, now });

    expect(status).toBe("processed");
    expect(retrieveRefund).toHaveBeenCalledWith("re_1");
    // The charge id comes from the RE-READ refund, never from the stale payload.
    expect(retrieveCharge).toHaveBeenCalledWith("ch_1");
    expect(revoke).toHaveBeenCalledWith(db, {
      stripePaymentIntentId: "pi_1",
      // The charge, not the refund object: `amount_refunded` is the cumulative
      // figure, so two partial refunds that add up to the whole charge are read
      // as the full refund they are.
      refundedAmountCents: 11880,
      chargeAmountCents: 11880,
      stripeEventId: "evt_refund.created",
      now,
    });
  });

  it("goes straight to the charge when Stripe reports the charge itself", async () => {
    const { stripe, retrieveRefund, retrieveCharge } = fakeStripe({
      charge: { amount: 11880, amountRefunded: 4752 },
    });

    const status = await handleRefundEvent(db, chargeRefunded, { stripe, now });

    expect(status).toBe("processed");
    expect(retrieveRefund).not.toHaveBeenCalled();
    expect(retrieveCharge).toHaveBeenCalledWith("ch_1");
    expect(revoke).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ refundedAmountCents: 4752, chargeAmountCents: 11880 }),
    );
  });

  it("reads an expanded payment intent as well as a bare id", async () => {
    const { stripe } = fakeStripe();
    const expanded = {
      ...stripe,
      charges: {
        retrieve: vi.fn(async (id: string) => ({
          id,
          object: "charge" as const,
          amount: 11880,
          amount_refunded: 11880,
          refunded: true,
          payment_intent: { id: "pi_expanded", object: "payment_intent" },
        })),
      },
    } as StripeRefundClient;

    await handleRefundEvent(db, chargeRefunded, { stripe: expanded, now });

    expect(revoke).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ stripePaymentIntentId: "pi_expanded" }),
    );
  });

  it("passes a replayed delivery through as processed", async () => {
    revoke.mockResolvedValue({
      outcome: "already_applied",
      organizationId: "org_1",
      lotId: "lot_1",
      status: "revoked",
    });
    const { stripe } = fakeStripe();

    expect(await handleRefundEvent(db, chargeRefunded, { stripe, now })).toBe("processed");
  });

  it("parks a refund the ledger refuses to apply automatically", async () => {
    revoke.mockResolvedValue({
      outcome: "needs_admin",
      organizationId: "org_1",
      lotId: "lot_1",
      reason: "partial_refund_not_prorata",
    });
    const { stripe } = fakeStripe();

    expect(await handleRefundEvent(db, chargeRefunded, { stripe, now })).toBe("needs_admin");
  });

  it("parks a refund for a payment we never granted a lot for, loudly", async () => {
    revoke.mockResolvedValue({ outcome: "no_lot" });
    const { stripe } = fakeStripe();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await handleRefundEvent(db, chargeRefunded, { stripe, now })).toBe("needs_admin");
    expect(logged).toHaveBeenCalled();
  });

  it("parks a charge that carries no payment intent instead of guessing one", async () => {
    const { stripe } = fakeStripe({ charge: { paymentIntentId: null } });

    expect(await handleRefundEvent(db, chargeRefunded, { stripe, now })).toBe("needs_admin");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("parks a refund that is attached to no charge", async () => {
    const { stripe, retrieveCharge } = fakeStripe({ refund: { chargeId: null } });

    expect(await handleRefundEvent(db, refundCreated, { stripe, now })).toBe("needs_admin");
    expect(retrieveCharge).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("handleDisputeEvent", () => {
  it("freezes on charge.dispute.created and notifies the organization", async () => {
    const { stripe, retrieveDispute } = fakeStripe();
    const notifyDisputeFrozen = vi.fn(async () => {});

    const status = await handleDisputeEvent(db, disputeCreated, {
      stripe,
      now,
      notifyDisputeFrozen,
    });

    expect(status).toBe("processed");
    expect(retrieveDispute).toHaveBeenCalledWith("dp_1");
    expect(freeze).toHaveBeenCalledWith(db, {
      stripePaymentIntentId: "pi_1",
      stripeEventId: "evt_charge.dispute.created",
      now,
    });
    // Amendment 16: a frozen customer discovering the block through their
    // candidates is the churn scenario.
    expect(notifyDisputeFrozen).toHaveBeenCalledWith({
      organizationId: "org_1",
      lotId: "lot_1",
      frozenCredits: 24,
      stripeEventId: "evt_charge.dispute.created",
    });
  });

  it("never lets a failed notification undo a freeze", async () => {
    const { stripe } = fakeStripe();
    const notifyDisputeFrozen = vi.fn(async () => {
      throw new Error("resend is down");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await handleDisputeEvent(db, disputeCreated, { stripe, now, notifyDisputeFrozen }),
    ).toBe("processed");
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
  });

  it("does not notify on a replayed freeze", async () => {
    freeze.mockResolvedValue({
      outcome: "already_applied",
      organizationId: "org_1",
      lotId: "lot_1",
      status: "frozen",
    });
    const { stripe } = fakeStripe();
    const notifyDisputeFrozen = vi.fn(async () => {});

    expect(
      await handleDisputeEvent(db, disputeCreated, { stripe, now, notifyDisputeFrozen }),
    ).toBe("processed");
    expect(notifyDisputeFrozen).not.toHaveBeenCalled();
  });

  it("parks a dispute the ledger refuses to freeze, and tells nobody but the operator", async () => {
    // The fully-consumed lot: the ledger parks it (`dispute_after_consumption`)
    // and the archive must carry that through to `needs_admin`, or the carding
    // pattern answers 200 and disappears. No email either — the freeze copy says
    // "N credits are blocked", which at N=0 would be a lie; `needs_admin` is the
    // channel.
    freeze.mockResolvedValue({
      outcome: "needs_admin",
      organizationId: "org_1",
      lotId: "lot_1",
      reason: "dispute_after_consumption",
    });
    const { stripe } = fakeStripe();
    const notifyDisputeFrozen = vi.fn(async () => {});

    expect(
      await handleDisputeEvent(db, disputeCreated, { stripe, now, notifyDisputeFrozen }),
    ).toBe("needs_admin");
    expect(notifyDisputeFrozen).not.toHaveBeenCalled();
  });

  it("unfreezes on a won dispute, reading the disposition from the API", async () => {
    const { stripe } = fakeStripe({ dispute: { status: "won" } });

    expect(await handleDisputeEvent(db, disputeClosed, { stripe, now })).toBe("processed");
    expect(resolve).toHaveBeenCalledWith(db, {
      stripePaymentIntentId: "pi_1",
      disposition: "won",
      stripeEventId: "evt_charge.dispute.closed",
      now,
    });
  });

  it("treats warning_closed as won (amendment 11)", async () => {
    const { stripe } = fakeStripe({ dispute: { status: "warning_closed" } });

    expect(await handleDisputeEvent(db, disputeClosed, { stripe, now })).toBe("processed");
    expect(resolve).toHaveBeenCalledWith(db, expect.objectContaining({ disposition: "won" }));
  });

  it("revokes on a lost dispute", async () => {
    const { stripe } = fakeStripe({ dispute: { status: "lost" } });

    expect(await handleDisputeEvent(db, disputeClosed, { stripe, now })).toBe("processed");
    expect(resolve).toHaveBeenCalledWith(db, expect.objectContaining({ disposition: "lost" }));
  });

  it("parks a closed dispute whose outcome is not a disposition we can act on", async () => {
    // `charge.dispute.closed` with a still-open status is a contradiction; the
    // money must not move on a guess.
    const { stripe } = fakeStripe({ dispute: { status: "under_review" } });

    expect(await handleDisputeEvent(db, disputeClosed, { stripe, now })).toBe("needs_admin");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("falls back to the charge when the dispute carries no payment intent", async () => {
    const { stripe, retrieveCharge } = fakeStripe({
      dispute: { paymentIntentId: null, chargeId: "ch_9" },
      charge: { paymentIntentId: "pi_from_charge" },
    });

    expect(await handleDisputeEvent(db, disputeCreated, { stripe, now })).toBe("processed");
    expect(retrieveCharge).toHaveBeenCalledWith("ch_9");
    expect(freeze).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ stripePaymentIntentId: "pi_from_charge" }),
    );
  });

  it("parks a dispute that resolves to no payment intent at all", async () => {
    const { stripe } = fakeStripe({ dispute: { paymentIntentId: null, chargeId: null } });

    expect(await handleDisputeEvent(db, disputeCreated, { stripe, now })).toBe("needs_admin");
    expect(freeze).not.toHaveBeenCalled();
  });

  it("parks a dispute on a payment no lot was granted for", async () => {
    freeze.mockResolvedValue({ outcome: "no_lot" });
    const { stripe } = fakeStripe();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await handleDisputeEvent(db, disputeCreated, { stripe, now })).toBe("needs_admin");
    expect(logged).toHaveBeenCalled();
  });
});
