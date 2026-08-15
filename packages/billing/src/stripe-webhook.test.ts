import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prelude/db";
import type Stripe from "stripe";

import type { CreditCheckoutFulfilment } from "./stripe-fulfilment";
import { handleDisputeEvent, handleRefundEvent } from "./stripe-refunds";
import { handleStripeWebhookEvent } from "./stripe-webhook";

/**
 * Task 7's handlers are mocked so the routing table can be proven at its
 * DEFAULTS — no injection — which is the only way to catch a dispatcher that
 * still falls through to `ignored`. What each handler decides is proven in
 * `stripe-refunds.test.ts`; what this file owns is that they are reached.
 */
vi.mock("./stripe-refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stripe-refunds")>();
  return { ...actual, handleRefundEvent: vi.fn(), handleDisputeEvent: vi.fn() };
});

const refundHandler = vi.mocked(handleRefundEvent);
const disputeHandler = vi.mocked(handleDisputeEvent);

beforeEach(() => {
  refundHandler.mockReset();
  disputeHandler.mockReset();
});

// Without this, `vi.spyOn(console, …)` in a later test returns the spy a
// previous test already installed — call history and all — and assertions on
// call counts silently measure the wrong thing.
afterEach(() => vi.restoreAllMocks());

const now = new Date("2026-08-15T09:00:00.000Z");

type ArchiveRow = {
  stripeEventId: string;
  type: string;
  payload: unknown;
  status: string;
  attemptCount: number;
  firstError: string | null;
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
        firstError: null,
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
      firstError: status === "failed" ? "stripe is down" : null,
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

  // The two rows the table left implicit. Both were only ever covered by an
  // attemptCount assertion, which would still pass if the status drifted.
  it("keeps a processed row processed across a replay", async () => {
    const archive = fakeArchive([parked("processed")]);

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling({ outcome: "already_granted" }), now },
    );

    expect(result).toEqual({ status: "processed" });
    expect(archive.rows.get("evt_1")?.status).toBe("processed");
    expect(archive.rows.get("evt_1")?.attemptCount).toBe(2);
  });

  it("keeps an ignored row ignored across a replay", async () => {
    const archive = fakeArchive([{ ...parked("ignored"), type: "payment_intent.succeeded" }]);

    const result = await handleStripeWebhookEvent(
      archive.db,
      otherEvent("payment_intent.succeeded"),
      { fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }), now },
    );

    expect(result).toEqual({ status: "ignored" });
    expect(archive.rows.get("evt_1")?.status).toBe("ignored");
    expect(archive.rows.get("evt_1")?.attemptCount).toBe(2);
  });

  /**
   * A parked row's `lastError` is its LIVE failure signal — the row is still
   * unresolved and still in the admin queue. A refused replay must not clear it,
   * and must not claim the replay settled anything.
   *
   * This combination escaped the first round because the `parked()` helper only
   * ever seeded `lastError: null` for a `needs_admin` row — so the clear had
   * nothing to erase and the bug was invisible.
   */
  it("never erases the live failure signal when the transition is refused", async () => {
    const archive = fakeArchive([
      {
        ...parked("needs_admin"),
        firstError: "unknown pack",
        lastError: "database unreachable",
      },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await handleStripeWebhookEvent(
      archive.db,
      checkoutEvent("checkout.session.completed"),
      { fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }), now },
    );

    expect(result).toEqual({ status: "needs_admin" });
    const row = archive.rows.get("evt_1");
    expect(row?.status).toBe("needs_admin");
    // The whole point: still unresolved, so the reason is still on the row.
    expect(row?.lastError).toBe("database unreachable");
    expect(row?.firstError).toBe("unknown pack");
    expect(row?.processedAt).toBeNull();
    // ...and nothing claimed this replay settled.
    expect(warn).not.toHaveBeenCalled();
  });

  it("reaches that state through real attempts, not just a seeded row", async () => {
    const archive = fakeArchive();
    const event = checkoutEvent("checkout.session.completed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // 1. Fulfilment refuses to grant — the row is parked for an operator.
    await handleStripeWebhookEvent(archive.db, event, {
      fulfill: fulfilling({ outcome: "unknown_pack" }),
      now,
    });
    expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");

    // 2. A retry throws — parked row records a live failure (documented row of
    //    the transition table: "stays parked, lastError recorded").
    await expect(
      handleStripeWebhookEvent(archive.db, event, {
        fulfill: vi.fn(async () => {
          throw new Error("database unreachable");
        }),
        now,
      }),
    ).rejects.toThrow("database unreachable");
    expect(archive.rows.get("evt_1")?.lastError).toBe("database unreachable");

    // Step 1 legitimately stamped processedAt: that attempt's own decision
    // (needs_admin) is the one that stuck. A distinct clock for step 3 makes the
    // next assertion sharp — a re-stamp would show up as `later`.
    expect(archive.rows.get("evt_1")?.processedAt).toEqual(now);
    const later = new Date("2026-08-15T11:00:00.000Z");

    // 3. A later retry succeeds — but the transition is still refused.
    await handleStripeWebhookEvent(archive.db, event, {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now: later,
    });

    const row = archive.rows.get("evt_1");
    expect(row?.status).toBe("needs_admin");
    expect(row?.lastError).toBe("database unreachable");
    // Untouched by the refused replay — still step 1's stamp, not `later`.
    expect(row?.processedAt).toEqual(now);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not stamp processedAt on a replay whose transition was refused", async () => {
    const archive = fakeArchive([parked("needs_admin")]);

    await handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    // The row still says needs_admin. A processedAt beside it would tell the
    // admin queue this event has been dealt with, which is the opposite of why
    // it is parked.
    expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");
    expect(archive.rows.get("evt_1")?.processedAt).toBeNull();
  });

  it("does stamp processedAt when the attempt's own decision is needs_admin", async () => {
    const archive = fakeArchive();

    await handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
      fulfill: fulfilling({ outcome: "amount_mismatch" }),
      now,
    });

    // This attempt ran to a decision and that decision stuck — the distinction
    // that makes processedAt mean something.
    expect(archive.rows.get("evt_1")?.status).toBe("needs_admin");
    expect(archive.rows.get("evt_1")?.processedAt).toEqual(now);
  });
});

/**
 * The two error columns. `firstError` is the forensic record — what went wrong
 * originally — and survives everything. `lastError` is the operational view —
 * what is wrong now — and is cleared, loudly, when a replay settles.
 */
describe("handleStripeWebhookEvent — failure history", () => {
  it("writes both columns on the first failure", async () => {
    const archive = fakeArchive();
    const fulfill = vi.fn(async () => {
      throw new Error("stripe timed out");
    });

    await expect(
      handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
        fulfill,
        now,
      }),
    ).rejects.toThrow("stripe timed out");

    const row = archive.rows.get("evt_1");
    expect(row?.firstError).toBe("stripe timed out");
    expect(row?.lastError).toBe("stripe timed out");
  });

  it("leaves firstError alone when a later attempt fails differently", async () => {
    const archive = fakeArchive();
    const event = checkoutEvent("checkout.session.completed");
    const fulfill = vi
      .fn<() => Promise<never>>()
      .mockRejectedValueOnce(new Error("stripe timed out"))
      .mockRejectedValueOnce(new Error("database unreachable"));

    await expect(
      handleStripeWebhookEvent(archive.db, event, { fulfill, now }),
    ).rejects.toThrow("stripe timed out");
    await expect(
      handleStripeWebhookEvent(archive.db, event, { fulfill, now }),
    ).rejects.toThrow("database unreachable");

    const row = archive.rows.get("evt_1");
    // The original cause is what explains the failure; the second attempt's
    // error would otherwise bury it.
    expect(row?.firstError).toBe("stripe timed out");
    expect(row?.lastError).toBe("database unreachable");
    expect(row?.attemptCount).toBe(2);
  });

  it("clears lastError on a settled replay, logs the clear, and keeps firstError", async () => {
    const archive = fakeArchive();
    const event = checkoutEvent("checkout.session.completed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fulfill = vi
      .fn()
      .mockRejectedValueOnce(new Error("stripe timed out"))
      .mockResolvedValueOnce({ outcome: "granted", lotId: "lot_1" });

    await expect(
      handleStripeWebhookEvent(archive.db, event, { fulfill, now }),
    ).rejects.toThrow("stripe timed out");
    const result = await handleStripeWebhookEvent(archive.db, event, { fulfill, now });

    expect(result).toEqual({ status: "processed" });
    const row = archive.rows.get("evt_1");
    expect(row?.lastError).toBeNull();
    // The failure still happened, and the row still says so.
    expect(row?.firstError).toBe("stripe timed out");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({
      stripeEventId: "evt_1",
      clearedError: "stripe timed out",
      status: "processed",
    });
  });

  it("does not log a clear when there was no failure to clear", async () => {
    const archive = fakeArchive();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    // Otherwise every ordinary purchase would log a line about nothing.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("handleStripeWebhookEvent — double fault", () => {
  it("propagates the HANDLER error when archiving that failure also fails", async () => {
    const archive = fakeArchive();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // The archive write rejects only for the failure path: the archive-first
    // upsert still succeeds, so this is precisely the double-fault case.
    archive.update.mockRejectedValue(new Error("archive write rejected"));
    const fulfill = vi.fn(async () => {
      throw new Error("stripe timed out");
    });

    // The caller must learn why the event failed, not why we failed to write it
    // down — the archive error would send an on-call engineer to the wrong system.
    await expect(
      handleStripeWebhookEvent(archive.db, checkoutEvent("checkout.session.completed"), {
        fulfill,
        now,
      }),
    ).rejects.toThrow("stripe timed out");

    // ...and the archive failure is still surfaced, separately.
    const logged = error.mock.calls.find((call) =>
      String(call[0]).includes("could not archive the handler failure"),
    );
    expect(logged).toBeDefined();
    expect(logged![1]).toMatchObject({ stripeEventId: "evt_1", handlerError: "stripe timed out" });
  });
});

/**
 * The Task 7 seam, now filled. The dispatcher owns the archive and the
 * transitions; refunds and disputes own their own ledger semantics. Injection
 * survives so a caller (the console route, the sweep) can decorate a handler
 * without rewriting the routing table.
 */
describe("handleStripeWebhookEvent — refund and dispute seam", () => {
  it.each(["charge.refunded", "refund.created"] as const)(
    "routes %s to the real refund handler with no injection at all",
    async (type) => {
      const archive = fakeArchive();
      refundHandler.mockResolvedValue("processed");

      const result = await handleStripeWebhookEvent(archive.db, otherEvent(type), { now });

      expect(refundHandler).toHaveBeenCalledTimes(1);
      expect(refundHandler.mock.calls[0]?.[1]).toMatchObject({ type });
      expect(result).toEqual({ status: "processed" });
    },
  );

  it.each(["charge.dispute.created", "charge.dispute.closed"] as const)(
    "routes %s to the real dispute handler with no injection at all",
    async (type) => {
      const archive = fakeArchive();
      disputeHandler.mockResolvedValue("processed");

      const result = await handleStripeWebhookEvent(archive.db, otherEvent(type), { now });

      expect(disputeHandler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "processed" });
    },
  );

  it("hands the freeze notifier to the dispute handler (amendment 16)", async () => {
    // The console route supplies the notifier; the dispatcher must not swallow it,
    // or a frozen recruiter learns about the block from their candidates.
    const archive = fakeArchive();
    disputeHandler.mockResolvedValue("processed");
    const notifyDisputeFrozen = vi.fn(async () => {});

    await handleStripeWebhookEvent(archive.db, otherEvent("charge.dispute.created"), {
      notifyDisputeFrozen,
      now,
    });

    expect(disputeHandler.mock.calls[0]?.[2]).toMatchObject({ notifyDisputeFrozen });
  });

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

  it("still ignores an event type nothing is subscribed to", async () => {
    const archive = fakeArchive();

    const result = await handleStripeWebhookEvent(archive.db, otherEvent("customer.updated"), {
      fulfill: fulfilling({ outcome: "granted", lotId: "lot_1" }),
      now,
    });

    expect(result).toEqual({ status: "ignored" });
    expect(archive.rows.get("evt_1")?.status).toBe("ignored");
    expect(refundHandler).not.toHaveBeenCalled();
    expect(disputeHandler).not.toHaveBeenCalled();
  });
});
