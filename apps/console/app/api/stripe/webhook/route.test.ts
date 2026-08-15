import { handleStripeWebhookEvent } from "@prelude/billing";
import { prisma } from "@prelude/db";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

/**
 * Only the dispatcher is mocked. `constructStripeEvent` stays REAL, because the
 * signature check is the entire security value of this route — a mocked verifier
 * would leave the one thing worth testing untested.
 */
vi.mock("@prelude/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prelude/billing")>();
  return { ...actual, handleStripeWebhookEvent: vi.fn() };
});

const dispatch = vi.mocked(handleStripeWebhookEvent);

/**
 * Signed with the real SDK, offline: `generateTestHeaderString` is what Stripe
 * ships for signing test payloads, so these are genuine HMACs over the exact
 * bytes the route will read. No Stripe account and no network involved.
 */
const stripe = new Stripe("sk_test_dummy");
const WEBHOOK_SECRET = "whsec_test";

const payload = JSON.stringify({
  id: "evt_1",
  object: "event",
  api_version: "2026-07-30.clover",
  created: 1_755_248_400,
  livemode: false,
  pending_webhooks: 1,
  request: { id: null, idempotency_key: null },
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", object: "checkout.session" } },
});

function sign(body: string, secret = WEBHOOK_SECRET) {
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}

function post(body: string, signature: string | null) {
  return new Request("https://console.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature === null ? {} : { "stripe-signature": signature },
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET);
  dispatch.mockReset();
  dispatch.mockResolvedValue({ status: "processed" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/stripe/webhook", () => {
  it("verifies the signature and hands the parsed event to the dispatcher", async () => {
    const response = await POST(post(payload, sign(payload)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "processed" });

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [db, event] = dispatch.mock.calls[0]!;
    // The route owns no state: it passes the app's Prisma client straight through.
    expect(db).toBe(prisma);
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("reports the dispatcher's status verbatim, including needs_admin", async () => {
    dispatch.mockResolvedValue({ status: "needs_admin" });

    const response = await POST(post(payload, sign(payload)));

    // 200 is correct here: the event WAS handled. Parking it for an operator is
    // a decision, not a delivery failure — asking Stripe to retry would only
    // pile up attempts on a payment no retry can fix.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "needs_admin" });
  });

  it("rejects a tampered body carrying the signature of the original", async () => {
    const header = sign(payload);
    const tampered = payload.replace('"cs_1"', '"cs_attacker"');

    const response = await POST(post(tampered, header));

    expect(response.status).toBe(400);
    // The one assertion that matters: forged money events never reach the ledger.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a body signed with someone else's secret", async () => {
    const response = await POST(post(payload, sign(payload, "whsec_someone_else")));

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a request with no stripe-signature header at all", async () => {
    const response = await POST(post(payload, null));

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects everything when STRIPE_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");

    const response = await POST(post(payload, sign(payload)));

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("answers 500 when the dispatcher throws, so Stripe retries", async () => {
    dispatch.mockRejectedValue(new Error("database unreachable"));

    const response = await POST(post(payload, sign(payload)));

    expect(response.status).toBe(500);
  });

  it("reads the raw body — a re-serialised payload would break the signature", async () => {
    // Stripe signs bytes, not JSON semantics. This body is the same object with
    // different whitespace: valid JSON, valid signature for ITSELF, and proof
    // the route never round-trips through `request.json()`.
    const spaced = JSON.stringify(JSON.parse(payload), null, 2);

    const response = await POST(post(spaced, sign(spaced)));

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
