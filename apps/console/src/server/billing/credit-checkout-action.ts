"use server";

import {
  createCreditCheckoutSession,
  isCreditBillingEnabled,
  isStripePurchaseConfigured,
} from "@prelude/billing";
import { prisma } from "@prelude/db";
import { headers } from "next/headers";

import { canPurchaseCredits } from "../../domain/organization-permissions";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";

/**
 * What the settings buy buttons call. The whole input surface is a pack id:
 * everything that decides WHO is billed — the organization and its name — comes
 * from the server-resolved session, never from the request body. A form field
 * naming an organization is exactly the hole this signature refuses to open.
 *
 * `visibility` is deliberately not consulted here: it gates the pricing surfaces
 * only (#139/amendment 20), so the "need more than 500 interviews?" line can
 * drive the quiet `volume_1000` pack through this same action.
 *
 * Returns rather than throws. A server action that rejects reaches the browser
 * as an opaque digest with no message, which would leave the recruiter staring
 * at a button that did nothing.
 */
export async function startCreditPackCheckout(
  packId: string,
): Promise<{ url?: string; error?: string }> {
  // Checked before the session is even resolved: with the kill switch off or
  // Stripe unconfigured there is nothing to sell, and no reason to touch the
  // database on a request that cannot succeed.
  if (!isCreditBillingEnabled() || !isStripePurchaseConfigured()) {
    return { error: "not_configured" };
  }

  const requestedPackId = packId?.trim();
  if (!requestedPackId) {
    return { error: "unknown_pack" };
  }

  const scope = await getCompletedOrganizationScope();

  // The role comes from the session's membership, like the organization itself —
  // the UI hides the buttons for a non-manager, but the UI is not a permission.
  // Applied to every pack including the quiet `volume_1000`: `visibility` gates
  // listing, it was never an authorization boundary.
  if (!canPurchaseCredits(scope.role)) {
    return { error: "not_allowed" };
  }

  try {
    const result = await createCreditCheckoutSession(prisma, {
      organizationId: scope.organizationId,
      organizationName: scope.organizationName,
      packId: requestedPackId,
      origin: await consoleOrigin(),
      now: new Date(),
    });

    return result.ok ? { url: result.url } : { error: result.error };
  } catch (error) {
    // Covers an unreachable Stripe, a catalogue priced outside {EUR, USD}
    // (`UnsupportedCreditCurrencyError`) and a session Stripe returned without a
    // redirect URL. None of them is the buyer's fault or the buyer's business:
    // the detail goes to the logs, the recruiter gets one honest line.
    console.error("[credit-checkout] failed to open a Checkout session", {
      organizationId: scope.organizationId,
      packId: requestedPackId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: "checkout_failed" };
  }
}

/**
 * The origin Stripe must send the buyer back to. Read from the live request
 * rather than an env var so preview deployments, `localhost:3000` and production
 * each return to themselves without configuration — a mis-set base URL would
 * strand every buyer on the wrong host after paying.
 *
 * `x-forwarded-*` wins because the proxy in front of the app is what knows the
 * public name and scheme; `host` alone is the internal one. This value only ever
 * builds a redirect back to our own console, never a trust decision.
 */
async function consoleOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${protocol}://${host}`;
}
