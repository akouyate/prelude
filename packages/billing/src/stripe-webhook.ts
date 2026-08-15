import type { Prisma, PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { fulfillCreditCheckout, type CreditCheckoutFulfilment } from "./stripe-fulfilment";

/** What the dispatcher reports back to its caller — and what the archive stores. */
export type StripeWebhookStatus = "processed" | "ignored" | "needs_admin";

/**
 * `failed` is an archived status but never a returned one: a handler that threw
 * is rethrown, the route answers 500, and Stripe retries. Nothing downstream
 * gets to treat a failure as an outcome.
 */
type ArchivedStatus = StripeWebhookStatus | "failed";

type CreditCheckoutFulfiller = (
  db: PrismaClient,
  input: { checkoutSessionId: string; stripeEventId: string; now: Date },
) => Promise<CreditCheckoutFulfilment>;

type StripeEventHandler = (db: PrismaClient, event: Stripe.Event) => Promise<StripeWebhookStatus>;

export type StripeWebhookDeps = {
  fulfill?: CreditCheckoutFulfiller;
  /** Task 7: `charge.refunded` / `refund.created`. Absent until then — those events are ignored. */
  handleRefund?: StripeEventHandler;
  /** Task 7: `charge.dispute.created` / `charge.dispute.closed`. */
  handleDispute?: StripeEventHandler;
  now?: Date;
};

/**
 * The single entry point behind the console's Stripe webhook route.
 *
 * Archive first, then act. The `StripeWebhookEvent` row is written before any
 * handler runs, so a crash mid-fulfilment still leaves a record of what arrived
 * and when — the alternative (act, then record) can move money and lose the
 * reason. The upsert on `stripeEventId` means a replayed event id updates its
 * row and bumps `attemptCount`; it never duplicates.
 *
 * Event-id dedupe is deliberately NOT the anti-double-credit guarantee — Stripe
 * can emit two distinct event ids for one payment, so a replay still calls
 * fulfilment and `CreditLot.stripePaymentIntentId @unique` is what refuses the
 * second grant. This function's job is the archive, the routing and the status.
 *
 * Throwing is meaningful: the route turns it into a 500 and Stripe retries.
 * Every non-throwing path is a decision we are willing to be final about.
 */
export async function handleStripeWebhookEvent(
  db: PrismaClient,
  event: Stripe.Event,
  deps: StripeWebhookDeps = {},
): Promise<{ status: StripeWebhookStatus }> {
  const { fulfill = fulfillCreditCheckout, handleRefund, handleDispute, now = new Date() } = deps;

  // The `update` branch touches only `attemptCount`, so what comes back carries
  // the row's PRIOR status — which is exactly what the transition guard needs,
  // without a second read.
  const archived = await db.stripeWebhookEvent.upsert({
    where: { stripeEventId: event.id },
    create: {
      stripeEventId: event.id,
      type: event.type,
      payload: event as unknown as Prisma.InputJsonValue,
      status: "received",
    },
    update: { attemptCount: { increment: 1 } },
  });
  const priorStatus = archived.status;

  let computed: StripeWebhookStatus;
  try {
    computed = await dispatch(db, event, { fulfill, handleRefund, handleDispute, now });
  } catch (error) {
    await db.stripeWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: {
        status: settleStatus(priorStatus, "failed", event),
        lastError: describeError(error),
      },
    });
    // Rethrow: the route's 500 is how we ask Stripe to try again. Swallowing
    // here would answer 200 for a payment nothing was done about.
    throw error;
  }

  const status = settleStatus(priorStatus, computed, event);
  await db.stripeWebhookEvent.update({
    where: { stripeEventId: event.id },
    data: { status, lastError: null, processedAt: now },
  });
  return { status };
}

/** The routing table. Task 7 supplies the two optional handlers and changes nothing here. */
async function dispatch(
  db: PrismaClient,
  event: Stripe.Event,
  deps: Required<Pick<StripeWebhookDeps, "fulfill" | "now">> &
    Pick<StripeWebhookDeps, "handleRefund" | "handleDispute">,
): Promise<StripeWebhookStatus> {
  switch (event.type) {
    // Both mean "the money may now be real". `completed` fires immediately;
    // `async_payment_succeeded` is the deferred-method (SEPA, bank transfer)
    // callback for a session that completed unpaid. Neither payload is trusted:
    // only the session id crosses over, and fulfilment re-reads it from Stripe.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const outcome = await deps.fulfill(db, {
        checkoutSessionId: event.data.object.id,
        stripeEventId: event.id,
        now: deps.now,
      });
      return archiveStatusForFulfilment(outcome);
    }

    // Nothing was collected and nothing will be. Recorded, closed, not retried.
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return "processed";

    case "charge.refunded":
    case "refund.created":
      return deps.handleRefund ? deps.handleRefund(db, event) : "ignored";

    case "charge.dispute.created":
    case "charge.dispute.closed":
      return deps.handleDispute ? deps.handleDispute(db, event) : "ignored";

    // Stripe delivers whatever the endpoint is subscribed to, and subscriptions
    // drift. An unrecognised type is archived and ignored — never an error, or
    // Stripe would retry it forever.
    default:
      return "ignored";
  }
}

/**
 * The Task 5 outcome contract, mapped onto the archive.
 *
 * `unknown_pack`, `amount_mismatch` and `needs_admin` all mean the same
 * operational thing: money arrived and no credits went out. `not_paid` is a
 * legitimate intermediate state Stripe will call back on, and
 * `no_payment_intent` is a wiring anomaly fulfilment already logged — neither is
 * a queue for a human.
 *
 * The `never` arm is load-bearing: `CreditCheckoutFulfilment` is exhaustive, so
 * adding an outcome in Task 7 or Phase 3 breaks the build here rather than
 * silently defaulting money into `processed`.
 */
function archiveStatusForFulfilment(outcome: CreditCheckoutFulfilment): StripeWebhookStatus {
  switch (outcome.outcome) {
    case "granted":
    case "already_granted":
    case "not_paid":
    case "no_payment_intent":
      return "processed";
    case "unknown_pack":
    case "amount_mismatch":
    case "needs_admin":
      return "needs_admin";
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unhandled fulfilment outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Amendment 8 — the archive keeps its history.
 *
 * `needs_admin` is terminal for the status column: only an operator clears it.
 * A replay that now succeeds must not erase the record that a human was asked to
 * look at this payment, because "it worked the second time" is not an answer to
 * "why did the first attempt refuse to grant". The attempt is still counted, the
 * error is still recorded, and the credits (if any) were still granted — the
 * ledger is the authority on that, not this column.
 *
 * Every other transition is allowed and explicit: `failed → processed` is the
 * whole point of Stripe's retries, and `processed → needs_admin` is an
 * escalation we always want to hear about.
 */
function settleStatus<T extends ArchivedStatus>(
  priorStatus: string,
  computed: T,
  event: Stripe.Event,
): T | "needs_admin" {
  if (priorStatus !== "needs_admin" || computed === "needs_admin") {
    return computed;
  }

  console.error("[stripe-webhook] replay of a parked event stays parked for an operator", {
    stripeEventId: event.id,
    type: event.type,
    attemptedStatus: computed,
  });
  return "needs_admin";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
