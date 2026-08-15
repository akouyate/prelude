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

  /**
   * Amendment 16. `@prelude/billing` deliberately does not depend on
   * `@prelude/notifications` — the ledger must move money without an email stack —
   * so the console is the layer that owns the dispatcher and hands it down. If
   * this wiring is dropped, the freeze still happens and the recruiter is never
   * told, which is exactly the silent failure the amendment exists to prevent.
   */
  it("hands the dispatcher a dispute-freeze notifier", async () => {
    await POST(post(payload, sign(payload)));

    const deps = dispatch.mock.calls[0]![2];
    expect(typeof deps?.notifyDisputeFrozen).toBe("function");
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

  it("rejects a genuine signature whose timestamp is outside the tolerance", async () => {
    // A captured-and-replayed delivery. The HMAC is authentic; only the clock
    // says no. Stripe's default tolerance is 300s.
    const stale = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    const response = await POST(post(payload, stale));

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * `StripeSignatureVerificationError` carries the rejected `payload` and
   * `header` as OWN PROPERTIES, so `console.error(msg, err)` writes the entire
   * unverified request body into the logs. This endpoint is unauthenticated:
   * that makes it a log-injection sink anyone on the internet can write to, and
   * a genuine-but-stale replay would spill real customer PII in plaintext.
   */
  it("never logs the unverified request body", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const secretish = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer_details: { email: "candidate@example.com", name: "Jane Candidate" },
        },
      },
    });

    const response = await POST(post(secretish, sign(payload)));
    expect(response.status).toBe(400);

    // Serialise exactly the way a JSON log pipeline does — own properties
    // included — which is what makes a logged Error object leak.
    const logged = errorLog.mock.calls
      .flat()
      .map((arg) =>
        arg instanceof Error ? JSON.stringify(arg, Object.getOwnPropertyNames(arg)) : String(arg),
      )
      .join(" ");

    expect(logged).not.toContain("candidate@example.com");
    expect(logged).not.toContain("Jane Candidate");
    expect(logged).not.toContain("cs_1");
    // Still reports the failure — the fix is to log less, not to go silent.
    expect(logged).toContain("signature verification failed");
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
