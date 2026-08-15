import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { grantPurchasedCreditLot, reconcileWallet } from "./credit-ledger";
import {
  handleDisputeEvent,
  handleRefundEvent,
  type StripeRefundClient,
} from "./stripe-refunds";
import {
  refundAndDisputeEventTypes,
  reprocessIgnoredStripeEvents,
} from "./stripe-webhook";

const databaseUrl = process.env.TEST_DATABASE_URL;

/** Only the Stripe API is faked: the handler, the dispatcher and the ledger are real. */
function fakeStripe(paymentIntentId: string, chargeAmountCents: number): StripeRefundClient {
  return {
    refunds: {
      retrieve: async (id: string) => ({
        id,
        charge: "ch_backfill",
        payment_intent: paymentIntentId,
        amount: chargeAmountCents,
      }),
    },
    charges: {
      retrieve: async (id: string) => ({
        id,
        amount: chargeAmountCents,
        amount_refunded: chargeAmountCents,
        payment_intent: paymentIntentId,
      }),
    },
    disputes: {
      retrieve: async (id: string) => ({
        id,
        status: "won",
        charge: "ch_backfill",
        payment_intent: paymentIntentId,
      }),
    },
  };
}

/**
 * The backfill Task 6's review asked for. Between Task 6 shipping the dispatcher
 * and Task 7 filling its seam, every refund and dispute that arrived was archived
 * `ignored` — a decision that looked final and was not. This proves those rows are
 * recoverable, against a real archive and a real ledger, because the whole failure
 * mode is "the row said ignored and nobody ever looked at it again".
 */
describe.skipIf(!databaseUrl)("reprocessIgnoredStripeEvents (Postgres)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    // The backfill selects by status across the whole archive, so a row this
    // suite left `ignored` on an earlier (or failed) run would be picked up by
    // the next one and skew the counts. Scoped to this suite's own id prefix.
    await db.stripeWebhookEvent.deleteMany({
      where: { stripeEventId: { startsWith: "evt_backfill_" } },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("re-dispatches an ignored refund and settles the lot it should have revoked", async () => {
    const organization = await db.organization.create({
      data: { name: `backfill-${Date.now()}-${Math.random()}` },
    });
    const organizationId = organization.id;
    const stripePaymentIntentId = `pi_backfill_${organizationId}`;
    const now = new Date(Date.now() - 60 * 60 * 1000);

    const granted = await grantPurchasedCreditLot(db, {
      organizationId,
      packId: "starter_25",
      creditsGranted: 25,
      unitAmountCents: 9900,
      currency: "EUR",
      stripePaymentIntentId,
      now,
    });
    expect(granted.outcome).toBe("granted");

    // The row exactly as the pre-Task-7 dispatcher left it: archived, ignored,
    // one attempt, never processed.
    const stripeEventId = `evt_backfill_${organizationId}`;
    await db.stripeWebhookEvent.create({
      data: {
        stripeEventId,
        type: "refund.created",
        status: "ignored",
        payload: {
          id: stripeEventId,
          object: "event",
          type: "refund.created",
          created: 1_755_248_400,
          livemode: false,
          pending_webhooks: 1,
          request: { id: null, idempotency_key: null },
          data: { object: { id: "re_backfill", object: "refund" } },
        },
      },
    });

    const deps = {
      handleRefund: (client: PrismaClient, event: Parameters<typeof handleRefundEvent>[1]) =>
        handleRefundEvent(client, event, {
          stripe: fakeStripe(stripePaymentIntentId, 11880),
          now,
        }),
    };

    const report = await reprocessIgnoredStripeEvents(db, {
      types: refundAndDisputeEventTypes,
      deps,
    });
    expect(report).toMatchObject({ reprocessed: 1, processed: 1, failed: 0 });

    expect(
      await db.creditLot.findUniqueOrThrow({ where: { stripePaymentIntentId } }),
    ).toMatchObject({ status: "revoked" });

    const archived = await db.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId } });
    expect(archived.status).toBe("processed");
    // The replay is counted, not hidden: the row still says it took two attempts.
    expect(archived.attemptCount).toBe(2);
    expect(archived.processedAt).not.toBeNull();

    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);

    // Idempotent by construction: the row is no longer `ignored`, so a second
    // sweep finds nothing to redo and the ledger is untouched.
    const second = await reprocessIgnoredStripeEvents(db, {
      types: refundAndDisputeEventTypes,
      deps,
    });
    expect(second.reprocessed).toBe(0);
    expect(
      await db.creditLedgerEntry.count({ where: { organizationId, type: "refund_reversal" } }),
    ).toBe(1);
  });

  /**
   * A backfilled freeze is still a freeze: the recruiter's credits become
   * unspendable at the moment the sweep runs, so amendment 16's notice is owed
   * exactly as much as it is on a live delivery — arguably more, since the
   * dispute has been open (and silent) since the row was first archived.
   *
   * `deps` is a REQUIRED parameter on `reprocessIgnoredStripeEvents` for this
   * reason: the notifier lives in the app layer, and a caller that forgets it
   * must fail to compile rather than freeze wallets quietly.
   */
  it("carries the freeze notifier into a backfilled dispute", async () => {
    const organization = await db.organization.create({
      data: { name: `backfill-dispute-${Date.now()}-${Math.random()}` },
    });
    const organizationId = organization.id;
    const stripePaymentIntentId = `pi_backfill_dispute_${organizationId}`;
    const now = new Date(Date.now() - 60 * 60 * 1000);

    await grantPurchasedCreditLot(db, {
      organizationId,
      packId: "starter_25",
      creditsGranted: 25,
      unitAmountCents: 9900,
      currency: "EUR",
      stripePaymentIntentId,
      now,
    });

    const stripeEventId = `evt_backfill_dispute_${organizationId}`;
    await db.stripeWebhookEvent.create({
      data: {
        stripeEventId,
        type: "charge.dispute.created",
        status: "ignored",
        payload: {
          id: stripeEventId,
          object: "event",
          type: "charge.dispute.created",
          created: 1_755_248_400,
          livemode: false,
          pending_webhooks: 1,
          request: { id: null, idempotency_key: null },
          data: { object: { id: "dp_backfill", object: "dispute" } },
        },
      },
    });

    const notifyDisputeFrozen = vi.fn(async () => {});
    const report = await reprocessIgnoredStripeEvents(db, {
      types: ["charge.dispute.created"],
      deps: {
        notifyDisputeFrozen,
        // Only the Stripe API is faked; the notifier has to reach the handler
        // through the dispatcher's own threading, not through this override.
        handleDispute: (client, event, handlerDeps) =>
          handleDisputeEvent(client, event, {
            stripe: fakeStripe(stripePaymentIntentId, 11880),
            now,
            ...handlerDeps,
          }),
      },
    });

    expect(report).toMatchObject({ reprocessed: 1, processed: 1, failed: 0 });
    expect(
      await db.creditLot.findUniqueOrThrow({ where: { stripePaymentIntentId } }),
    ).toMatchObject({ status: "frozen" });
    expect(notifyDisputeFrozen).toHaveBeenCalledWith({
      organizationId,
      lotId: expect.any(String),
      // The whole paid lot: nothing was held or consumed before the freeze.
      frozenCredits: 25,
      stripeEventId,
    });
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("refuses at compile time to be called without deps", () => {
    // Never invoked — the assertion IS the type error. A sweep that omits `deps`
    // would freeze wallets and notify nobody, so it has to fail the build rather
    // than production; `@ts-expect-error` fails `tsc` the moment `deps` goes
    // back to being optional.
    const withoutDeps = () =>
      // @ts-expect-error — `deps` is a required parameter.
      reprocessIgnoredStripeEvents(db, { types: refundAndDisputeEventTypes });
    expect(typeof withoutDeps).toBe("function");
  });
});
