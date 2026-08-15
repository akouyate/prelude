import type { Prisma, PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import { fulfillCreditCheckout, type CreditCheckoutFulfilment } from "./stripe-fulfilment";
import {
  handleDisputeEvent,
  handleRefundEvent,
  type DisputeFreezeNotifier,
} from "./stripe-refunds";

/** What the dispatcher reports back to its caller — and what the archive stores. */
export type StripeWebhookStatus = "processed" | "ignored" | "needs_admin";

/**
 * The money-EXIT event types. Named because two callers need the same list: the
 * routing table below, and the backfill that recovers rows archived `ignored`
 * before Task 7 existed.
 */
export const refundAndDisputeEventTypes = [
  "refund.created",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
] as const;

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

type StripeRefundEventHandler = (
  db: PrismaClient,
  event: Stripe.Event,
) => Promise<StripeWebhookStatus>;

/**
 * The dispute handler takes a third argument the refund one does not: the
 * notifier hook (amendment 16). It stays optional so the dispatcher can be
 * exercised — and the ledger driven — without an email stack.
 */
type StripeDisputeEventHandler = (
  db: PrismaClient,
  event: Stripe.Event,
  handlerDeps: { notifyDisputeFrozen?: DisputeFreezeNotifier },
) => Promise<StripeWebhookStatus>;

export type StripeWebhookDeps = {
  fulfill?: CreditCheckoutFulfiller;
  /** `charge.refunded` / `refund.created` — defaults to Task 7's handler. */
  handleRefund?: StripeRefundEventHandler;
  /** `charge.dispute.created` / `charge.dispute.closed` — defaults to Task 7's handler. */
  handleDispute?: StripeDisputeEventHandler;
  /**
   * Amendment 16. Supplied by the console webhook route, which owns the
   * notification dispatcher; absent everywhere else, and never able to fail a
   * freeze (the dispute handler swallows and logs its errors).
   */
  notifyDisputeFrozen?: DisputeFreezeNotifier;
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
 *
 * Failure history is kept in two columns with different jobs (see the schema
 * comment): `firstError` is written once on the first failure and never
 * overwritten — the forensic record — while `lastError` tracks the most recent
 * failure and is cleared when a replay finally settles, with the clear logged.
 */
export async function handleStripeWebhookEvent(
  db: PrismaClient,
  event: Stripe.Event,
  deps: StripeWebhookDeps = {},
): Promise<{ status: StripeWebhookStatus }> {
  const {
    fulfill = fulfillCreditCheckout,
    handleRefund = handleRefundEvent,
    handleDispute = handleDisputeEvent,
    notifyDisputeFrozen,
    now = new Date(),
  } = deps;

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
    computed = await dispatch(db, event, {
      fulfill,
      handleRefund,
      handleDispute,
      notifyDisputeFrozen,
      now,
    });
  } catch (error) {
    const message = describeError(error);
    try {
      await db.stripeWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: settleStatus(priorStatus, "failed", event),
          lastError: message,
          // Written once, on the FIRST failure, and never overwritten: the
          // original cause is what explains a failure, and a later attempt
          // failing differently must not be able to erase it.
          ...(archived.firstError === null ? { firstError: message } : {}),
        },
      });
    } catch (archiveError) {
      // Double fault: the handler failed AND we could not record it. Log this
      // separately — it is a different, worse problem than the handler failure,
      // and it must not be mistaken for one.
      console.error("[stripe-webhook] could not archive the handler failure", {
        stripeEventId: event.id,
        type: event.type,
        handlerError: message,
        // Our own infrastructure error, not attacker-controlled — the stack is
        // the useful part here, unlike the verification error in the route.
        archiveError,
      });
    }
    // Rethrow the ORIGINAL handler error, never the archive error: the route's
    // 500 is how we ask Stripe to try again, and the caller must see the reason
    // the event failed, not the reason we failed to write it down.
    throw error;
  }

  const status = settleStatus(priorStatus, computed, event);
  // `settleStatus` refused this attempt's decision — the row keeps a status
  // this attempt did not produce.
  const parked = status !== computed;

  if (!parked && archived.lastError !== null) {
    // Symmetric with the parking refusal below: every erasure of failure
    // history is visible. `firstError` survives, so the forensic record does
    // not depend on anyone having read this line.
    console.warn("[stripe-webhook] clearing the recorded failure after a settled replay", {
      stripeEventId: event.id,
      type: event.type,
      clearedError: archived.lastError,
      status,
    });
  }

  await db.stripeWebhookEvent.update({
    where: { stripeEventId: event.id },
    data: {
      status,
      // Both of these say "this attempt's decision stuck", so both are gated on
      // the same condition. On a refused transition the row keeps a status this
      // attempt did not produce, and it is still unresolved in the admin queue:
      // `lastError` is its LIVE failure signal, not stale history, and clearing
      // it would delete the only record of what is currently wrong. Stamping
      // `processedAt` beside it would tell the queue amendment 8 exists for that
      // the event has been dealt with.
      ...(parked ? {} : { lastError: null, processedAt: now }),
    },
  });
  return { status };
}

/** The routing table. */
async function dispatch(
  db: PrismaClient,
  event: Stripe.Event,
  deps: Required<Pick<StripeWebhookDeps, "fulfill" | "handleRefund" | "handleDispute" | "now">> &
    Pick<StripeWebhookDeps, "notifyDisputeFrozen">,
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

    // Money leaving. Both types describe one fact and both are routed: the
    // ledger's status-guarded transitions are what make the second delivery a
    // no-op, not a filter here.
    case "charge.refunded":
    case "refund.created":
      return deps.handleRefund(db, event);

    case "charge.dispute.created":
    case "charge.dispute.closed":
      return deps.handleDispute(db, event, {
        notifyDisputeFrozen: deps.notifyDisputeFrozen,
      });

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
    // Unreachable from here — `foreign_session` requires an
    // `expectedOrganizationId`, which only the browser-return route passes and
    // this dispatcher never does. Listed rather than defaulted so the `never` arm
    // below keeps its meaning, and mapped to `needs_admin` because if it ever DID
    // arrive it would mean money landed and nothing was granted.
    case "foreign_session":
    case "needs_admin":
      return "needs_admin";
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unhandled fulfilment outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type StripeEventReprocessReport = {
  reprocessed: number;
  processed: number;
  needsAdmin: number;
  stillIgnored: number;
  failed: number;
};

/** How many archived rows one backfill pass will re-dispatch by default. */
const REPROCESS_BATCH_LIMIT = 100;

/**
 * Recovers events the dispatcher archived `ignored` before a handler for them
 * existed.
 *
 * The gap is real and dated: Task 6 shipped the routing table with the refund and
 * dispute arms falling through to `ignored`, so every chargeback and refund that
 * arrived between then and Task 7 was recorded as a decision we were "willing to
 * be final about" — and was not. Stripe's own retries cannot fix that (we
 * answered 200), so the only way back is to re-read our own archive.
 *
 * Safe to run repeatedly, and safe to run over money: it re-dispatches through
 * `handleStripeWebhookEvent`, so each row gets the same archive-first upsert, the
 * same attempt counting and the same transition guard as a live delivery, and the
 * ledger's status guards make a lot that was already settled report
 * `already_applied` rather than move twice. A row stops being selected the moment
 * it leaves `ignored`.
 *
 * One row's failure never aborts the pass: a throw is counted and logged, because
 * a single unfetchable Stripe object must not strand every later row.
 *
 * `deps` is REQUIRED, with no default. A backfilled `charge.dispute.created`
 * freezes a wallet exactly as a live one does, so it owes the recruiter the same
 * notice (amendment 16) — arguably more, since the dispute has been open and
 * silent since the row was archived. The notifier lives in the app layer, so a
 * caller that forgets it has to fail the BUILD rather than quietly freeze
 * wallets and tell nobody. Pass `{}` only where that is genuinely intended.
 */
export async function reprocessIgnoredStripeEvents(
  db: PrismaClient,
  input: {
    deps: StripeWebhookDeps;
    types?: readonly string[];
    limit?: number;
  },
): Promise<StripeEventReprocessReport> {
  const { deps, types = refundAndDisputeEventTypes, limit = REPROCESS_BATCH_LIMIT } = input;

  const rows = await db.stripeWebhookEvent.findMany({
    where: { status: "ignored", type: { in: [...types] } },
    orderBy: { receivedAt: "asc" },
    take: limit,
  });

  const report: StripeEventReprocessReport = {
    reprocessed: 0,
    processed: 0,
    needsAdmin: 0,
    stillIgnored: 0,
    failed: 0,
  };

  for (const row of rows) {
    // The archive stores the event verbatim, so the payload IS the event. It is
    // still checked rather than cast blindly: a row whose payload was truncated
    // or hand-edited must be reported, not fed to a money handler.
    const event = row.payload as unknown as Stripe.Event | null;
    if (!event || typeof event !== "object" || event.id !== row.stripeEventId) {
      report.failed += 1;
      console.error("[stripe-webhook] archived payload is not the event it claims to be", {
        stripeEventId: row.stripeEventId,
        type: row.type,
      });
      continue;
    }

    report.reprocessed += 1;
    try {
      const { status } = await handleStripeWebhookEvent(db, event, deps);
      if (status === "processed") report.processed += 1;
      else if (status === "needs_admin") report.needsAdmin += 1;
      else report.stillIgnored += 1;
    } catch (error) {
      report.failed += 1;
      console.error("[stripe-webhook] reprocessing an archived event failed", {
        stripeEventId: row.stripeEventId,
        type: row.type,
        error: describeError(error),
      });
    }
  }

  return report;
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
