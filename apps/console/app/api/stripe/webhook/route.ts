import { constructStripeEvent, handleStripeWebhookEvent } from "@prelude/billing";
import { prisma } from "@prelude/db";
import { createNotificationDispatcher } from "@prelude/notifications";
import type { NextRequest } from "next/server";

const notificationDispatcher = createNotificationDispatcher();

// Stripe's event endpoint for credit purchases. Public route (no Clerk session)
// — authenticity comes entirely from the `stripe-signature` HMAC, verified
// against STRIPE_WEBHOOK_SECRET before a single byte of the body is trusted.
//
// Deliberately thin, mirroring the Clerk webhook route: verify, delegate,
// translate the outcome into a status code. Every decision about what an event
// means — the archive, idempotence, fulfilment, what gets parked for a human —
// lives in `handleStripeWebhookEvent` in `@prelude/billing`, where it is unit
// tested without a request object.
//
// Amendment 7: this file imports NOTHING from `stripe`. `constructStripeEvent`
// is the package's named boundary for signature verification, which keeps the
// payment SDK out of the console entirely (`stripe` is a devDependency here, for
// the offline signature tests only).
//
// Local development:
//   stripe listen --forward-to localhost:3000/api/stripe/webhook
// That prints a `whsec_…` unique to your machine and session. It belongs in
// `.env.local`, NEVER in the shared dotenvx-encrypted `.env` (amendment 12):
// every developer's CLI session has a different one, and committing yours would
// break everyone else's forwarding.
//
// Retries: a non-2xx makes Stripe redeliver — roughly 3 days of retries in live
// mode, 3 attempts in test mode, after which Stripe disables the endpoint and
// emails the account. That window is why a handler failure answers 500 rather
// than swallowing the error, and why anything past it is recovered by the
// missed-event sweep (Task 9) rather than by Stripe.
export async function POST(request: NextRequest) {
  // The raw body, before anything parses it. `request.json()` would re-serialise
  // the payload and invalidate the signature — Stripe signs bytes, not JSON.
  const payload = await request.text();

  let event;
  try {
    event = constructStripeEvent(payload, request.headers.get("stripe-signature") ?? "");
  } catch (error) {
    // Covers an unset secret, an absent or malformed header, a forged body and a
    // replayed-too-late timestamp alike. None of them may reach the ledger, and
    // none of them is worth a retry.
    //
    // MESSAGE ONLY — never the error object. `StripeSignatureVerificationError`
    // carries the rejected `payload` and `header` as own properties, so logging
    // the error itself writes the entire unverified request body into our logs.
    // On an unauthenticated endpoint that is a log-injection sink anyone on the
    // internet can write to, and a genuine-but-stale replay would spill real
    // `customer_details` in plaintext. The message alone names the failure.
    console.error(
      "[stripe-webhook] signature verification failed",
      error instanceof Error ? error.message : String(error),
    );
    return new Response("Webhook verification failed", { status: 400 });
  }

  try {
    const result = await handleStripeWebhookEvent(prisma, event, {
      // Amendment 16 — the freeze notifies the recruiter. The hook is wired HERE
      // rather than inside `@prelude/billing` on purpose: the notification
      // dispatcher reaches for the Prisma singleton and pulls React and the email
      // provider with it, and moving money must not depend on any of that. The
      // dispute handler swallows and logs a notification failure, so this can
      // never turn a committed freeze into a 500 and a Stripe retry.
      notifyDisputeFrozen: ({ organizationId, frozenCredits, stripeEventId }) =>
        notificationDispatcher.notifyCreditDisputeFrozen({
          frozenCredits,
          organizationId,
          stripeEventId,
        }),
    });
    // `needs_admin` is still a 200: the event was handled and parked on purpose.
    // Retrying it would pile up attempts on a payment no retry can fix.
    return Response.json(result);
  } catch (error) {
    console.error("[stripe-webhook] dispatch failed", event.type, event.id, error);
    // 500 asks Stripe to redeliver. The dispatcher archived the failure before
    // rethrowing, and fulfilment is idempotent, so a retry is safe.
    return new Response("Webhook dispatch failed", { status: 500 });
  }
}
