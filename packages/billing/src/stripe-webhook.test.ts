import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import type { CreditCheckoutFulfilment } from "./stripe-fulfilment";
import { handleStripeWebhookEvent } from "./stripe-webhook";

const now = new Date("2026-08-15T09:00:00.000Z");

type ArchiveRow = {
  stripeEventId: string;
  type: string;
  payload: unknown;
  status: string;
  attemptCount: number;
  lastError: string | null;
  receivedAt: Date;
  processedAt: Date | null;
};

/**
 * An honest `stripeWebhookEvent` stand-in — the three Prisma behaviours the
 * dispatcher actually leans on, and nothing softened:
 *
 * - `upsert` returns the row **after** the write. The dispatcher's `update`
 *   branch touches only `attemptCount`, so the returned `status` is the row's
 *   PRIOR status: that is the whole mechanism behind amendment 8's transition
 *   guard, and a fake that returned the create-shape on replay would hide it.
 * - `{ increment: n }` is applied as Prisma applies it, not as an overwrite —
 *   otherwise `attemptCount` would look correct while never counting anything.
 * - `update` on a missing row THROWS (Prisma's P2025), so an implementation that
 *   forgot to archive first cannot quietly finish.
 */
function fakeArchive(seed: ArchiveRow[] = []) {
  const rows = new Map(seed.map((row) => [row.stripeEventId, { ...row }]));

  function applyData(row: Record<string, unknown>, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === "object" && "increment" in value) {
        row[key] = (row[key] as number) + (value as { increment: number }).increment;
        continue;
      }
      row[key] = value;
    }
  }

  const upsert = vi.fn(
    async ({
      where,
      create,
      update,
    }: {
      where: { stripeEventId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const existing = rows.get(where.stripeEventId);
      if (existing) {
        applyData(existing as unknown as Record<string, unknown>, update);
        return { ...existing };
      }
      const created = {
        status: "received",
        attemptCount: 1,
        lastError: null,
        receivedAt: now,
        processedAt: null,
        ...create,
      } as ArchiveRow;
      rows.set(where.stripeEventId, created);
      return { ...created };
    },
  );

  const update = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { stripeEventId: string };
      data: Record<string, unknown>;
    }) => {
      const existing = rows.get(where.stripeEventId);
      if (!existing) {
        throw new Error(
          "An operation failed because it depends on one or more records that were required but not found (P2025)",
        );
      }
      applyData(existing as unknown as Record<string, unknown>, data);
      return { ...existing };
    },
  );

  const db = { stripeWebhookEvent: { upsert, update } } as unknown as PrismaClient;
  return { db, rows, upsert, update };
}

/**
 * The envelope Stripe actually posts: the event carries the object, and the
 * object inside a webhook payload is NEVER expanded. The dispatcher is only
 * allowed to read the id out of it — everything else is re-read from the API by
 * fulfilment — so the fixture deliberately carries nothing else useful.
 */
function checkoutEvent(
  type:
    | "checkout.session.completed"
    | "checkout.session.async_payment_succeeded"
    | "checkout.session.async_payment_failed"
    | "checkout.session.expired",
  overrides: { id?: string; sessionId?: string } = {},
): Stripe.Event {
  const { id = "evt_1", sessionId = "cs_1" } = overrides;
  return {
    id,
    object: "event",
    api_version: "2026-07-30.clover",
    created: 1_755_248_400,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: { id: sessionId, object: "checkout.session" } },
  } as unknown as Stripe.Event;
}

function otherEvent(type: string, id = "evt_1"): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2026-07-30.clover",
    created: 1_755_248_400,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: { id: "obj_1", object: type.split(".")[0] } },
  } as unknown as Stripe.Event;
}

function fulfilling(outcome: CreditCheckoutFulfilment) {
  return vi.fn(async () => outcome);
}

describe("handleStripeWebhookEvent — the archive", () => {
  it("writes the archive row BEFORE the handler runs", async () => {
    const archive = fakeArchive();
    let seenDuringHandler: ArchiveRow | null = null;
    const fulfill = vi.fn(async () => {
      const row = archive.rows.get("evt_1");
      seenDuringHandler = row ? { ...row } : null;
      return { outcome: "granted", lotId: "lot_1" } as const;
    });

    await handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
      fulfill,
      now,
    });

    // Money moved before we had a record of why would be the unrecoverable
    // failure mode: the row exists, at attempt 1, while the handler is running.
    expect(seenDuringHandler).not.toBeNull();
    expect(seenDuringHandler!.status).toBe("received");
    expect(seenDuringHandler!.attemptCount).toBe(1);
    expect(seenDuringHandler!.type).toBe("checkout.session.completed");
  });

  it("archives the whole event payload and its type", async () => {
    const archive = fakeArchive();
    const event = checkoutEvent("checkout.session.completed");

    await handleStripeWebhookEvent(archive.db, event, {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    const row = archive.rows.get("evt_1");
    expect(row?.type).toBe("checkout.session.completed");
    expect(row?.payload).toEqual(event);
  });

  it("upserts on a replayed event id — one row, attemptCount incremented", async () => {
    const archive = fakeArchive();
    const event = checkoutEvent("checkout.session.completed");
    const fulfill = fulfilling({ outcome: "already_granted" });

    await handleStripeWebhookEvent(archive.db, event, { fulfill, now });
    await handleStripeWebhookEvent(archive.db, event, { fulfill, now });

    expect(archive.rows.size).toBe(1);
    expect(archive.rows.get("evt_1")?.attemptCount).toBe(2);
    // Dedupe is hygiene, never the anti-double-credit guarantee: fulfilment is
    // called again and the ledger's unique payment intent is what refuses.
    expect(fulfill).toHaveBeenCalledTimes(2);
  });

  it("stamps processedAt and clears lastError on a clean run", async () => {
    const archive = fakeArchive();

    await handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    const row = archive.rows.get("evt_1");
    expect(row?.processedAt).toEqual(now);
    expect(row?.lastError).toBeNull();
  });
});

describe("handleStripeWebhookEvent — checkout fulfilment", () => {
  it.each([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ] as const)("routes %s to fulfilment with the session id and the event id", async (type) => {
    const archive = fakeArchive();
    const fulfill = fulfilling({ outcome: "granted", lotId: "lot_1" });

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent(type, { id: "evt_9", sessionId: "cs_9" }),
      { fulfill, now },
    );

    expect(fulfill).toHaveBeenCalledWith(archive.db, {
      checkoutSessionId: "cs_9",
      stripeEventId: "evt_9",
      now,
    });
    expect(result).toEqual({ status: "processed" });
  });

  // The Task 5 outcome contract, mapped whole. `not_paid` and `no_payment_intent`
  // are NOT admin business: the first is a deferred method Stripe will call back
  // on, the second is a wiring anomaly the logs already carry.
  it.each<[CreditCheckoutFulfilment, "processed" | "needs_admin"]>([
    [{ outcome: "granted", lotId: "lot_1" }, "processed"],
    [{ outcome: "already_granted" }, "processed"],
    [{ outcome: "not_paid" }, "processed"],
    [{ outcome: "no_payment_intent" }, "processed"],
    [{ outcome: "unknown_pack" }, "needs_admin"],
    [{ outcome: "amount_mismatch" }, "needs_admin"],
    [{ outcome: "needs_admin", reason: "missing_metadata" }, "needs_admin"],
    [{ outcome: "needs_admin", reason: "no_payment_required" }, "needs_admin"],
  ])("maps fulfilment %o onto archive status %s", async (outcome, expected) => {
    const archive = fakeArchive();

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling(outcome), now },
    );

    expect(result).toEqual({ status: expected });
    expect(archive.rows.get("evt_1")?.status).toBe(expected);
  });
});

describe("handleStripeWebhookEvent — events that grant nothing", () => {
  it.each(["checkout.session.async_payment_failed", "checkout.session.expired"] as const)(
    "archives %s as processed without calling fulfilment",
    async (type) => {
      const archive = fakeArchive();
      const fulfill = fulfilling({ outcome: "granted", lotId: "lot_1" });

      const result = await handleStripeWebhookEvent(archive.db, checkoutEvent(type), {
        fulfill,
        now,
      });

      expect(fulfill).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "processed" });
      expect(archive.rows.get("evt_1")?.status).toBe("processed");
    },
  );

  it("ignores an event type nothing here handles, but still archives it", async () => {
    const archive = fakeArchive();
    const fulfill = fulfilling({ outcome: "granted", lotId: "lot_1" });

    const result = await handleStripeWebhookEvent(
      archive.db,
      otherEvent("payment_intent.succeeded"),
      { fulfill, now },
    );

    expect(fulfill).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ignored" });
    expect(archive.rows.get("evt_1")?.status).toBe("ignored");
  });
});

describe("handleStripeWebhookEvent — handler failure", () => {
  it("archives failed with the error message, then rethrows so Stripe retries", async () => {
    const archive = fakeArchive();
    const fulfill = vi.fn(async () => {
      throw new Error("stripe is down");
    });

    await expect(
      handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
        fulfill,
        now,
      }),
    ).rejects.toThrow("stripe is down");

    const row = archive.rows.get("evt_1");
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("stripe is down");
    // A failed attempt never claims a processing time.
    expect(row?.processedAt).toBeNull();
  });

  it("records a non-Error throw rather than losing it", async () => {
    const archive = fakeArchive();
    const fulfill = vi.fn(async () => {
      throw "boom";
    });

    await expect(
      handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
        fulfill,
        now,
      }),
    ).rejects.toBe("boom");

    expect(archive.rows.get("evt_1")?.lastError).toContain("boom");
  });
});

/**
 * Amendment 8 — the archive keeps its history. A replay must never quietly erase
 * the reason a human was asked to look at a payment.
 */
describe("handleStripeWebhookEvent — status transitions", () => {
  function parked(status: string): ArchiveRow {
    return {
      stripeEventId: "evt_1",
      type: "checkout.session.completed",
      payload: {},
      status,
      attemptCount: 1,
      lastError: status === "failed" ? "stripe is down" : null,
      receivedAt: now,
      processedAt: null,
    };
  }

  it("never clears a prior needs_admin, even when the replay would succeed", async () => {
    const archive = fakeArchive([parked("needs_admin")]);

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }), now },
    );

    expect(result).toEqual({ status: "needs_admin" });
    expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");
    expect(archive.rows.get("evt_1")?.attemptCount).toBe(2);
  });

  it("keeps a parked row parked when the replay throws, and still rethrows", async () => {
    const archive = fakeArchive([parked("needs_admin")]);
    const fulfill = vi.fn(async () => {
      throw new Error("database unreachable");
    });

    await expect(
      handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
        fulfill,
        now,
      }),
    ).rejects.toThrow("database unreachable");

    const row = archive.rows.get("evt_1");
    expect(row?.status).toBe("needs_admin");
    expect(row?.lastError).toBe("database unreachable");
  });

  it("lets a retried failure become processed — that is what retries are for", async () => {
    const archive = fakeArchive([parked("failed")]);

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }), now },
    );

    expect(result).toEqual({ status: "processed" });
    expect(archive.rows.get("evt_1")?.status).toBe("processed");
    expect(archive.rows.get("evt_1")?.lastError).toBeNull();
  });

  it("escalates a previously processed row to needs_admin", async () => {
    const archive = fakeArchive([parked("processed")]);

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling({ outcome: "amount_mismatch" }), now },
    );

    expect(result).toEqual({ status: "needs_admin" });
    expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");
  });
});

/**
 * The Task 7 seam. The dispatcher owns the archive and the transitions; refunds
 * and disputes own their own ledger semantics. Task 7 supplies the two handlers
 * and changes nothing here.
 */
describe("handleStripeWebhookEvent — refund and dispute seam", () => {
  it.each(["charge.refunded", "refund.created"] as const)(
    "routes %s to handleRefund when one is injected",
    async (type) => {
      const archive = fakeArchive();
      const handleRefund = vi.fn(async () => "needs_admin" as const);

      const result = await handleStripeWebhookEvent(archive.db, otherEvent(type), {
        fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
        handleRefund,
        now,
      });

      expect(handleRefund).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "needs_admin" });
      expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");
    },
  );

  it.each(["charge.dispute.created", "charge.dispute.closed"] as const)(
    "routes %s to handleDispute when one is injected",
    async (type) => {
      const archive = fakeArchive();
      const handleDispute = vi.fn(async () => "processed" as const);

      const result = await handleStripeWebhookEvent(archive.db, otherEvent(type), {
        fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
        handleDispute,
        now,
      });

      expect(handleDispute).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "processed" });
    },
  );

  it("ignores refund events until Task 7 injects a handler", async () => {
    const archive = fakeArchive();

    const result = await handleStripeWebhookEvent(archive.db, otherEvent("charge.refunded"), {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    expect(result).toEqual({ status: "ignored" });
    expect(archive.rows.get("evt_1")?.status).toBe("ignored");
  });
});
