import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import {
  freezeLotForDispute,
  resolveDisputeOnLot,
  revokeUnconsumedLot,
  type CreditLotAdjustmentResult,
} from "./credit-ledger";
import { getStripeClient } from "./stripe-client";
import type { StripeWebhookStatus } from "./stripe-webhook";

/**
 * The slice of the Stripe SDK the money-exit handlers touch — a structural port
 * the real client satisfies as-is, so tests inject a fake without casting a whole
 * `Stripe` instance (same discipline as `StripeFulfilmentClient`).
 *
 * Every expandable field keeps BOTH shapes (`string | { id } | null`). Stripe
 * never expands anything inside a webhook payload and types these fields
 * open-endedly whatever we request, so the readers below narrow, always.
 */
export type StripeRefundClient = {
  refunds: {
    retrieve(
      id: string,
      params?: Stripe.RefundRetrieveParams,
      options?: Stripe.RequestOptions,
    ): Promise<{
      id: string;
      charge: string | { id: string } | null;
      payment_intent: string | { id: string } | null;
      amount: number;
    }>;
  };
  charges: {
    retrieve(
      id: string,
      params?: Stripe.ChargeRetrieveParams,
      options?: Stripe.RequestOptions,
    ): Promise<{
      id: string;
      amount: number;
      amount_refunded: number;
      payment_intent: string | { id: string } | null;
    }>;
  };
  disputes: {
    retrieve(
      id: string,
      params?: Stripe.DisputeRetrieveParams,
      options?: Stripe.RequestOptions,
    ): Promise<{
      id: string;
      status: string;
      charge: string | { id: string } | null;
      payment_intent: string | { id: string } | null;
    }>;
  };
};

/**
 * Amendment 16 — the freeze notifies the recruiter.
 *
 * A hook rather than a direct call, because enqueuing the email needs the console
 * app's notification dispatcher (`@prelude/notifications` reaches for the Prisma
 * singleton and pulls React + the email provider with it), and `@prelude/billing`
 * must not depend on any of that to move money. The console webhook route wires
 * the real dispatcher; the ledger stays testable without an email stack.
 */
export type DisputeFreezeNotifier = (input: {
  organizationId: string;
  lotId: string;
  frozenCredits: number;
  stripeEventId: string;
}) => Promise<unknown>;

export type StripeRefundHandlerDeps = {
  stripe?: StripeRefundClient;
  now?: Date;
};

export type StripeDisputeHandlerDeps = StripeRefundHandlerDeps & {
  notifyDisputeFrozen?: DisputeFreezeNotifier;
};

/**
 * `refund.created` and `charge.refunded` — Stripe's two ways of saying the same
 * thing, both routed here.
 *
 * Nothing in the delivered payload is trusted: webhook payloads are eventually
 * consistent, so the object is re-read from the API and the decision is made on
 * the CHARGE. The charge is the right anchor for two reasons — it carries
 * `amount_refunded` as a *cumulative* figure (so two partial refunds that add up
 * to the whole charge are recognised as the full refund they are), and it is the
 * only place both event types converge without duplicating the arithmetic.
 *
 * The ledger owns every money rule; this function owns identification. That is
 * why an unresolvable charge or payment intent parks rather than guesses: a
 * refund is not worth attaching to the wrong lot.
 */
export async function handleRefundEvent(
  db: PrismaClient,
  event: Stripe.Event,
  deps: StripeRefundHandlerDeps = {},
): Promise<StripeWebhookStatus> {
  const { stripe = getStripeClient(), now = new Date() } = deps;
  const delivered = event.data.object as { id: string };

  let chargeId: string | undefined;
  if (event.type === "refund.created") {
    const refund = await stripe.refunds.retrieve(delivered.id);
    chargeId = idOf(refund.charge);
    if (!chargeId) {
      // Every refund we can act on settles a charge. One without is either a
      // shape this pipeline has never seen or a payment-intent-level refund whose
      // charge Stripe has not attached yet — neither is worth guessing at.
      console.error("[stripe-refunds] refund is attached to no charge", {
        stripeEventId: event.id,
        refundId: refund.id,
      });
      return "needs_admin";
    }
  } else {
    chargeId = delivered.id;
  }

  const charge = await stripe.charges.retrieve(chargeId);
  const stripePaymentIntentId = idOf(charge.payment_intent);
  if (!stripePaymentIntentId) {
    console.error("[stripe-refunds] refunded charge carries no payment intent", {
      stripeEventId: event.id,
      chargeId: charge.id,
    });
    return "needs_admin";
  }

  const result = await revokeUnconsumedLot(db, {
    stripePaymentIntentId,
    refundedAmountCents: charge.amount_refunded,
    chargeAmountCents: charge.amount,
    stripeEventId: event.id,
    now,
  });
  return archiveStatusFor(result, event, stripePaymentIntentId);
}

/**
 * `charge.dispute.created` (freeze) and `charge.dispute.closed` (resolve).
 *
 * The event TYPE decides which transition to run; the RE-READ dispute decides the
 * disposition. Reading the disposition off the delivered payload would be the
 * classic eventual-consistency bug: a `closed` payload that still says
 * `under_review` would unfreeze nothing, or worse, revoke on a stale `lost`.
 *
 * Amendment 11: `warning_closed` — an early-warning enquiry the bank dropped
 * without escalating to a chargeback — maps to the `won` path, because the money
 * stayed with us. A `closed` event carrying any still-open status is a
 * contradiction and parks instead of guessing a disposition.
 */
export async function handleDisputeEvent(
  db: PrismaClient,
  event: Stripe.Event,
  deps: StripeDisputeHandlerDeps = {},
): Promise<StripeWebhookStatus> {
  const { stripe = getStripeClient(), now = new Date(), notifyDisputeFrozen } = deps;
  const delivered = event.data.object as { id: string };

  const dispute = await stripe.disputes.retrieve(delivered.id);
  const stripePaymentIntentId = await resolvePaymentIntentId(stripe, dispute);
  if (!stripePaymentIntentId) {
    console.error("[stripe-refunds] dispute resolves to no payment intent", {
      stripeEventId: event.id,
      disputeId: dispute.id,
    });
    return "needs_admin";
  }

  if (event.type === "charge.dispute.created") {
    const frozen = await freezeLotForDispute(db, {
      stripePaymentIntentId,
      stripeEventId: event.id,
      now,
    });
    if (frozen.outcome === "applied") {
      await notifyFreeze(notifyDisputeFrozen, {
        organizationId: frozen.organizationId,
        lotId: frozen.lotId,
        frozenCredits: frozen.credits,
        stripeEventId: event.id,
      });
    }
    return archiveStatusFor(frozen, event, stripePaymentIntentId);
  }

  const disposition = toDisposition(dispute.status);
  if (!disposition) {
    console.error("[stripe-refunds] closed dispute carries no actionable outcome", {
      stripeEventId: event.id,
      disputeId: dispute.id,
      disputeStatus: dispute.status,
    });
    return "needs_admin";
  }

  const resolved = await resolveDisputeOnLot(db, {
    stripePaymentIntentId,
    disposition,
    stripeEventId: event.id,
    now,
  });
  return archiveStatusFor(resolved, event, stripePaymentIntentId);
}

/**
 * Amendment 16's guarantee: the recruiter is told, and telling them can never
 * undo the freeze. The money already moved in its own committed transaction —
 * an email provider outage must not turn that into a 500 and a Stripe retry.
 */
async function notifyFreeze(
  notify: DisputeFreezeNotifier | undefined,
  input: {
    organizationId: string;
    lotId: string;
    frozenCredits: number;
    stripeEventId: string;
  },
): Promise<void> {
  if (!notify) {
    return;
  }
  try {
    await notify(input);
  } catch (error) {
    console.error("[stripe-refunds] dispute freeze notification failed", {
      ...input,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Modern disputes carry the payment intent directly; older ones only name the
 * charge. Retrieving the charge is the fallback, not the default — one API call
 * is worth avoiding on the hot path, and the direct field is authoritative.
 */
async function resolvePaymentIntentId(
  stripe: StripeRefundClient,
  dispute: { payment_intent: string | { id: string } | null; charge: string | { id: string } | null },
): Promise<string | undefined> {
  const direct = idOf(dispute.payment_intent);
  if (direct) {
    return direct;
  }
  const chargeId = idOf(dispute.charge);
  if (!chargeId) {
    return undefined;
  }
  const charge = await stripe.charges.retrieve(chargeId);
  return idOf(charge.payment_intent);
}

/**
 * Stripe's dispute statuses, mapped onto the two dispositions the ledger knows.
 * Anything still open is deliberately unmapped — see the `closed` guard above.
 */
function toDisposition(status: string): "won" | "lost" | null {
  switch (status) {
    case "won":
    // An early-warning enquiry closed without becoming a chargeback: the funds
    // were never taken, so it settles exactly like a win (amendment 11).
    case "warning_closed":
      return "won";
    case "lost":
      return "lost";
    default:
      return null;
  }
}

/**
 * Task 6's archive contract.
 *
 * `already_applied` is `processed`, not `needs_admin`: a replay of a settled fact
 * is the expected case, and parking it would queue a human behind Stripe's own
 * retry policy. `no_lot` is `needs_admin` AND logged — money came back for a
 * payment this system never credited, which is a wiring anomaly no retry fixes.
 */
function archiveStatusFor(
  result: CreditLotAdjustmentResult,
  event: Stripe.Event,
  stripePaymentIntentId: string,
): StripeWebhookStatus {
  switch (result.outcome) {
    case "applied":
    case "already_applied":
      return "processed";
    case "no_lot":
      console.error("[stripe-refunds] no credit lot exists for this payment", {
        stripeEventId: event.id,
        type: event.type,
        stripePaymentIntentId,
      });
      return "needs_admin";
    case "needs_admin":
      return "needs_admin";
    default: {
      const exhaustive: never = result;
      throw new Error(`unhandled ledger outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Expandable fields arrive as an id or as the object; `undefined` keeps callers honest. */
function idOf(field: string | { id: string } | null | undefined): string | undefined {
  if (field === null || field === undefined) return undefined;
  return typeof field === "string" ? field : field.id;
}
