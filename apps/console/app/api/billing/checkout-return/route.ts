import {
  fulfillCreditCheckout,
  isCreditBillingEnabled,
  isStripePurchaseConfigured,
  type CreditCheckoutFulfilment,
} from "@prelude/billing";
import { prisma } from "@prelude/db";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { canPurchaseCredits } from "@/domain/organization-permissions";
import { getCompletedOrganizationScope } from "@/server/organizations/organization-scope";

/**
 * Where Stripe sends the buyer after a hosted Checkout (amendment 6).
 *
 * This is a route handler and NOT the settings server component on purpose. The
 * `session_id` is a query parameter — attacker input, indistinguishable from one
 * a recruiter typed — and a page that fulfilled whatever `cs_…` it was handed
 * would be an enumeration oracle over every organization's checkouts. So:
 * authenticate, resolve the organization from the SESSION, and let fulfilment
 * refuse anything that does not belong to it.
 *
 * It then redirects to `/settings?view=billing&purchase=<outcome>`, which is why
 * the id never survives a reload: no re-fulfilment on F5, and no `cs_…` sitting
 * in browser history or in a referrer header.
 *
 * This path is a convenience, never the source of truth. The webhook
 * (`/api/stripe/webhook`) and the missed-event sweep both fulfil the same
 * session, and all three are idempotent through the ledger's unique payment
 * intent — so a buyer who closes the tab still gets their credits, and a failure
 * here is a banner rather than lost money.
 */
export async function GET(request: NextRequest) {
  // Resolved before the redirect so the throw (an unauthenticated caller) is not
  // swallowed by the `redirect()` control-flow exception below.
  const destination = await resolveReturnOutcome(request.nextUrl.searchParams.get("session_id"));

  redirect(`/settings?view=billing&purchase=${destination}`);
}

type PurchaseBannerOutcome =
  | "granted"
  | "already"
  | "processing"
  | "not_allowed"
  | "error";

async function resolveReturnOutcome(sessionId: string | null): Promise<PurchaseBannerOutcome> {
  if (!isCreditBillingEnabled() || !isStripePurchaseConfigured()) {
    return "error";
  }

  // Cheap input hygiene: only a Checkout session id is worth an API call, and a
  // malformed parameter must not become traffic against Stripe on our key.
  const checkoutSessionId = sessionId?.trim();
  if (!checkoutSessionId || !checkoutSessionId.startsWith("cs_")) {
    return "error";
  }

  // A hosted Checkout page sits open for minutes while a card is entered, so the
  // console session can be gone by the time Stripe sends the buyer back here.
  // Letting the scope resolution throw would render the application error page —
  // with `?session_id=cs_…` still in the address bar — at the exact moment the
  // customer just paid. That is the worst screen we could possibly show, and the
  // money is never at stake: the webhook and the missed-event sweep fulfil this
  // same session, so a failed browser return costs a banner, not credits.
  //
  // Why `/settings` rather than a hand-rolled sign-in redirect carrying a
  // return-to back here — measured against the real Clerk setup, not assumed:
  //
  //  1. An unauthenticated return NEVER REACHES THIS CODE. `proxy.ts` runs
  //     `auth.protect()` on every non-public route, so Clerk answers first, and it
  //     already carries the return-to this fix was asked for:
  //
  //       GET /api/billing/checkout-return?session_id=cs_1   (no session)
  //       → 307 …/v1/client/handshake?redirect_url=
  //           http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fbilling%2Fcheckout-return
  //           %3Fsession_id%3Dcs_1
  //
  //     The session id survives the round trip, so after re-authentication the
  //     buyer lands back here and the fulfilment/banner path completes. A
  //     hand-rolled sign-in redirect would duplicate that — badly, and in the one
  //     place where getting auth wrong is most expensive.
  //
  //  2. What remains for this catch is therefore the AUTHENTICATED but
  //     un-onboarded caller (and any transient scope failure). Sign-in is the
  //     wrong destination for them — they already have a session — and a
  //     return-to pointing back at this route would bounce them through
  //     sign-in → here → throw → sign-in forever. A redirect loop is strictly
  //     worse than the 500 it replaced. `/settings` is protected and behind the
  //     onboarding guard, so it routes them wherever they actually need to go.
  //
  // The redirect shape is identical to every other failure, so the security
  // contract is untouched: fulfilment is unreachable and nothing is distinguishable.
  let scope;
  try {
    scope = await getCompletedOrganizationScope();
  } catch (error) {
    console.error("[credit-checkout-return] no usable console session on return", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "error";
  }

  // The same owner/admin line the buy action draws, applied on the way back too.
  // Nothing is lost by refusing here: the webhook and the missed-event sweep
  // fulfil this session regardless, so a non-manager who opens a return link
  // simply does not get to trigger it — one rule instead of two.
  if (!canPurchaseCredits(scope.role)) {
    return "not_allowed";
  }

  try {
    const result = await fulfillCreditCheckout(prisma, {
      checkoutSessionId,
      // The whole point of the route. Fulfilment refuses — before it reads the
      // payment status, before it touches the catalogue, before any grant — any
      // session whose metadata names a different organization.
      expectedOrganizationId: scope.organizationId,
      now: new Date(),
    });

    return bannerOutcomeFor(result);
  } catch (error) {
    console.error("[credit-checkout-return] fulfilment failed", {
      organizationId: scope.organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "error";
  }
}

/**
 * Four outcomes reach the browser, and they are OUR vocabulary, not fulfilment's.
 *
 * Everything that is neither a grant nor a pending payment collapses into one
 * `error`: `foreign_session`, `unknown_pack`, `amount_mismatch` and the parked
 * cases would each tell the caller something different about a session they may
 * not own, and none of the distinctions is actionable by a recruiter anyway.
 *
 * The `never` arm keeps the collapse deliberate: a new fulfilment outcome breaks
 * this build instead of quietly defaulting into "error" — or, worse, into a
 * success banner over a purchase that never landed.
 */
function bannerOutcomeFor(result: CreditCheckoutFulfilment): PurchaseBannerOutcome {
  switch (result.outcome) {
    case "granted":
      return "granted";
    case "already_granted":
      // The webhook won the race — the credits ARE there. Showing an error here
      // would be the most confusing possible answer to a successful purchase.
      return "already";
    case "not_paid":
      // SEPA debit and bank transfers settle after Checkout returns; Stripe calls
      // the webhook again when the funds land.
      return "processing";
    case "foreign_session":
    case "unknown_pack":
    case "no_payment_intent":
    case "amount_mismatch":
    case "currency_mismatch":
    case "needs_admin":
      return "error";
    default: {
      const exhaustive: never = result;
      throw new Error(`unhandled checkout return outcome: ${JSON.stringify(exhaustive)}`);
    }
  }
}
