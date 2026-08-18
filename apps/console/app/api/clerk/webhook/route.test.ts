import { inspect } from "node:util";

import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { syncClerkOrganizationBilling } from "@prelude/billing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyClerkSyncIntent,
  planClerkWebhookSync,
} from "@/server/organizations/clerk-webhook-sync";

import { POST } from "./route";

vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: vi.fn() }));
vi.mock("@prelude/billing/server", () => ({
  syncClerkOrganizationBilling: vi.fn(),
}));
vi.mock("@/server/organizations/clerk-webhook-sync", () => ({
  applyClerkSyncIntent: vi.fn(),
  planClerkWebhookSync: vi.fn(),
}));
vi.mock("@/server/organizations/clerk-webhook-store", () => ({
  prismaClerkSyncStore: {},
}));

const verify = vi.mocked(verifyWebhook);
const plan = vi.mocked(planClerkWebhookSync);
const apply = vi.mocked(applyClerkSyncIntent);
const syncBilling = vi.mocked(syncClerkOrganizationBilling);

function post() {
  return new Request("https://console.test/api/clerk/webhook", {
    method: "POST",
    body: "{}",
  }) as unknown as Parameters<typeof POST>[0];
}

// `inspect(depth: null)` is what `console.error` actually does to a
// non-string argument: it walks own properties recursively, nested objects
// included. Filtering by JSON.stringify's array-replacer would only check
// property NAMES at each level and could hide a leak nested under an
// allow-listed key — this must observe what actually reaches the log.
function serializeLogs(calls: unknown[][]) {
  return calls
    .flat()
    .map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: null })))
    .join(" ");
}

beforeEach(() => {
  verify.mockReset();
  plan.mockReset();
  apply.mockReset();
  syncBilling.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/clerk/webhook", () => {
  it("returns 400 and never logs the raw error object when signature verification fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    // Shaped like Svix's verification error: the rejected payload/headers
    // hang off the error as own properties, same failure mode already fixed
    // on the Stripe webhook route.
    const secretish = Object.assign(new Error("Webhook verification failed"), {
      payload: { email_addresses: [{ email_address: "candidate@example.com" }] },
      headers: { "svix-signature": "v1,abc" },
    });
    verify.mockRejectedValue(secretish);

    const response = await POST(post());

    expect(response.status).toBe(400);
    const logged = serializeLogs(errorLog.mock.calls);
    expect(logged).not.toContain("candidate@example.com");
    expect(logged).toContain("Webhook verification failed");
  });

  it("does not act on an event planClerkWebhookSync ignores", async () => {
    verify.mockResolvedValue({ type: "organization.created", data: {} } as never);
    plan.mockReturnValue(null);

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ignored: true,
      type: "organization.created",
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns a non-2xx (so Svix retries) when the organization is not yet provisioned, rather than acknowledging and dropping the event forever", async () => {
    verify.mockResolvedValue({
      type: "organizationMembership.created",
      data: {},
    } as never);
    plan.mockReturnValue({
      kind: "membership",
      action: "upsert",
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_clerk_1",
      email: "new@example.com",
      name: "New User",
      role: "recruiter",
    });
    apply.mockResolvedValue({
      applied: false,
      reason: "organization_not_found",
    });

    const response = await POST(post());

    expect(response.status).not.toBe(200);
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(response.json()).resolves.toEqual({
      applied: false,
      reason: "organization_not_found",
    });
  });

  it("returns a non-2xx for a billing event too, when the organization is not yet provisioned", async () => {
    // Identical failure mode to the membership case above, on the billing
    // branch: subscription.*/subscriptionItem.* events (which .env.example
    // tells operators to subscribe to) can race onboarding exactly like a
    // membership event can. syncClerkOrganizationBilling reports the same
    // {applied:false, reason:"organization_not_found"} shape
    // (packages/billing/src/server.ts:154) and a bare 200 here would drop it
    // forever, same as the membership branch this route already fixes.
    verify.mockResolvedValue({ type: "subscription.updated", data: {} } as never);
    plan.mockReturnValue({
      kind: "billing",
      clerkOrganizationId: "org_clerk_1",
      sourceUpdatedAt: undefined,
    });
    syncBilling.mockResolvedValue({
      applied: false,
      reason: "organization_not_found",
    });

    const response = await POST(post());

    expect(response.status).not.toBe(200);
    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(response.json()).resolves.toEqual({
      applied: false,
      reason: "organization_not_found",
    });
  });

  it.each(["billing_disabled", "billing_unconfigured", "stale_source_update"])(
    "still returns 200 for a billing event parked for a PERMANENT reason (%s), not just a not-yet-provisioned race",
    async (reason) => {
      verify.mockResolvedValue({ type: "subscription.updated", data: {} } as never);
      plan.mockReturnValue({
        kind: "billing",
        clerkOrganizationId: "org_clerk_1",
        sourceUpdatedAt: undefined,
      });
      syncBilling.mockResolvedValue({ applied: false, reason });

      const response = await POST(post());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ applied: false, reason });
    },
  );

  it("returns 200 for a successfully applied sync", async () => {
    verify.mockResolvedValue({
      type: "organizationMembership.created",
      data: {},
    } as never);
    plan.mockReturnValue({
      kind: "membership",
      action: "upsert",
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_clerk_1",
      email: "new@example.com",
      name: "New User",
      role: "recruiter",
    });
    apply.mockResolvedValue({ applied: true });

    const response = await POST(post());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ applied: true });
  });

  it("returns 500 and never logs the raw error object when the sync dispatch throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    verify.mockResolvedValue({
      type: "organizationMembership.created",
      data: {},
    } as never);
    plan.mockReturnValue({
      kind: "membership",
      action: "upsert",
      clerkOrganizationId: "org_clerk_1",
      clerkUserId: "user_clerk_1",
      email: "new@example.com",
      name: "New User",
      role: "recruiter",
    });
    // Shaped like a Prisma error carrying the rejected write payload as an
    // own property (the exact failure mode already fixed on the Stripe route).
    const prismaish = Object.assign(
      new Error("Invalid `prisma.organizationMembership.upsert()` invocation"),
      { data: { email: "candidate@example.com" } },
    );
    apply.mockRejectedValue(prismaish);

    const response = await POST(post());

    expect(response.status).toBe(500);
    const logged = serializeLogs(errorLog.mock.calls);
    expect(logged).not.toContain("candidate@example.com");
    expect(logged).toContain("sync failed");
  });
});
