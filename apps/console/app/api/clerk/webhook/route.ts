import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { syncClerkOrganizationBilling } from "@prelude/billing/server";
import type { NextRequest } from "next/server";

import {
  applyClerkSyncIntent,
  planClerkWebhookSync,
} from "@/server/organizations/clerk-webhook-sync";
import { prismaClerkSyncStore } from "@/server/organizations/clerk-webhook-store";

// Clerk is the admin source of truth for organizations, memberships, and
// invitations; this Svix-signed endpoint projects those changes into our DB so
// console authZ reads a synced membership. Public route (no Clerk session) —
// authenticity comes from the Svix signature (CLERK_WEBHOOK_SIGNING_SECRET).
export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch (error) {
    // MESSAGE ONLY — never the error object. Same bug already fixed on the
    // Stripe route (see the comment at app/api/stripe/webhook/route.ts:47-57):
    // the verification error carries the rejected payload/headers as own
    // properties, so logging the error itself writes the entire unverified
    // request body into our logs — a log-injection sink on a public,
    // unauthenticated endpoint.
    console.error(
      "[clerk-webhook] signature verification failed",
      error instanceof Error ? error.message : String(error),
    );
    return new Response("Webhook verification failed", { status: 400 });
  }

  const intent = planClerkWebhookSync({
    type: event.type,
    data: event.data as unknown as Record<string, unknown>,
  });
  if (!intent) {
    return Response.json({ ignored: true, type: event.type });
  }

  try {
    if (intent.kind === "billing") {
      const result = await syncClerkOrganizationBilling({
        clerkOrganizationId: intent.clerkOrganizationId,
        sourceUpdatedAt: intent.sourceUpdatedAt,
      });
      // Same race as the membership branch below, on subscription.*/
      // subscriptionItem.* events: syncClerkOrganizationBilling returns this
      // exact {applied:false, reason:"organization_not_found"} shape
      // (packages/billing/src/server.ts:154) when the org hasn't been
      // provisioned yet, and a bare 200 would drop it forever. Narrowly
      // scoped to that one reason — "billing_disabled"/"billing_unconfigured"
      // and "stale_source_update" are correct PERMANENT outcomes (the
      // feature is off, or we already have newer data) and must stay 200; a
      // retry can never change either.
      if (!result.applied && result.reason === "organization_not_found") {
        return Response.json(result, { status: 409 });
      }
      return Response.json(result);
    }
    const result = await applyClerkSyncIntent(prismaClerkSyncStore, intent);
    if (!result.applied && result.reason === "organization_not_found") {
      // NOT a 200. The organization has not been provisioned in our DB yet
      // (e.g. this event raced onboarding completion). Svix does not retry a
      // 2xx response, and there is no later event that re-syncs a static
      // membership on its own — acknowledging this with 200 would drop the
      // event forever (see clerk-webhook-sync.ts for the full consequence: a
      // subsequent onboarding pass by someone who DOES exist can then
      // overwrite the workspace this invitee was trying to join). 409 asks
      // Svix to redeliver with backoff until the organization exists.
      return Response.json(result, { status: 409 });
    }
    return Response.json(result);
  } catch (error) {
    // MESSAGE ONLY, for the same reason as the 400 path above.
    console.error(
      "[clerk-webhook] sync failed",
      event.type,
      error instanceof Error ? error.message : String(error),
    );
    // 500 asks Svix to retry; the sync is idempotent so retries are safe.
    return new Response("Webhook sync failed", { status: 500 });
  }
}
