import { verifyWebhook } from "@clerk/nextjs/webhooks";
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
    console.error("[clerk-webhook] signature verification failed", error);
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
    const result = await applyClerkSyncIntent(prismaClerkSyncStore, intent);
    return Response.json(result);
  } catch (error) {
    console.error("[clerk-webhook] sync failed", event.type, error);
    // 500 asks Svix to retry; the sync is idempotent so retries are safe.
    return new Response("Webhook sync failed", { status: 500 });
  }
}
