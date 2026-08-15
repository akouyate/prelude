import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  FIRST_FIVE_CREDITS,
  FIRST_FIVE_EXPIRY_DAYS,
  grantPurchasedCreditLot,
  InvalidCreditPurchaseAmountError,
  MissingCreditWalletError,
  PAID_CREDIT_EXPIRY_DAYS,
  reconcileWallet,
  releaseExpiredReservations,
  releaseReservationForSession,
  RESERVATION_TTL_HOURS,
  reserveCreditForSession,
} from "./credit-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The widest fan-out in this file (the ten-way admission race). Every one of those
 * callers holds a Prisma connection for the whole interactive transaction, so the
 * pool has to be at least this large for them to contend on the wallet row lock.
 */
const MAX_TEST_PARALLELISM = 10;

/**
 * Pinned, not inherited. Prisma's default pool is `cpus * 2 + 1` — 21 on a ten-core
 * laptop, 9 on a four-core CI runner — and a URL may carry its own `connection_limit`.
 * Below `MAX_TEST_PARALLELISM` the losers of the concurrency tests queue on the
 * *connection pool* instead of on the row lock: the tests still pass, but they stop
 * proving the thing they exist to prove. A proof of contention must pin its contention
 * in the code, so the pool is set here rather than left to whatever host runs it.
 */
const TEST_CONNECTION_LIMIT = MAX_TEST_PARALLELISM + 6;

function withPinnedPool(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", String(TEST_CONNECTION_LIMIT));
  return parsed.toString();
}

// `set` rather than append, so a `connection_limit` already carried by
// `TEST_DATABASE_URL` is overridden instead of silently winning.
const pooledDatabaseUrl = databaseUrl ? withPinnedPool(databaseUrl) : undefined;

describe.skipIf(!databaseUrl)("credit ledger (Postgres)", () => {
  let db: PrismaClient;
  let organizationId: string;

  // `reconcileWallet` audits against the real clock (the wallet row is supposed to
  // describe the balance *now*), so a hard-coded fixture date would silently start
  // failing once real time passed the granted lot's expiry. Deriving the fixture
  // clock from `Date.now()` keeps the suite date-independent. One hour in the past,
  // so every fixture operation reads as "already happened" relative to the audit.
  const now = new Date(Date.now() - HOUR_MS);

  // `CreditReservation.candidateSessionId` is globally unique, so fixed literals
  // would collide with rows left by an earlier run against the same database.
  // Scoping the ids to this run's organization keeps the suite re-runnable.
  const session = (name: string) => `${name}_${organizationId}`;

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: pooledDatabaseUrl } } });
    const organization = await db.organization.create({
      data: { name: `ledger-test-${Date.now()}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("grants First Five exactly once and walks reserve → capture", async () => {
    await ensureWallet(db, { organizationId, now });
    await ensureWallet(db, { organizationId, now });
    const lots = await db.creditLot.findMany({ where: { organizationId } });
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ kind: "free", source: "first_five", creditsGranted: 5 });

    const reserved = await reserveCreditForSession(db, {
      organizationId,
      candidateSessionId: session("cs_1"),
      now,
    });
    expect(reserved.ok).toBe(true);

    const captured = await captureReservationForSession(db, {
      organizationId,
      candidateSessionId: session("cs_1"),
      now,
    });
    expect(captured.outcome).toBe("captured");

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 4, reservedCredits: 0 });

    const audit = await reconcileWallet(db, { organizationId });
    expect(audit.consistent).toBe(true);
  });

  it("releases instead of consuming when the interview is not billable", async () => {
    await reserveCreditForSession(db, { organizationId, candidateSessionId: session("cs_2"), now });
    const released = await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId: session("cs_2"),
      now,
      reason: "below_billable_threshold",
    });
    expect(released.outcome).toBe("released");
    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 4, reservedCredits: 0 });
  });

  it("expires a due lot and keeps balances honest", async () => {
    const { expiredLotIds } = await expireDueLots(db, {
      organizationId,
      now: new Date(now.getTime() + 30 * DAY_MS + 1000), // 30 days + ε after the grant
    });
    expect(expiredLotIds).toHaveLength(1);
    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet.availableCredits).toBe(0);
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  // Everything below runs on its own organization so the walkthrough above stays
  // readable; these pin the money invariants the three-step walkthrough cannot.
  async function grantedOrganization(): Promise<string> {
    const organization = await db.organization.create({
      data: { name: `ledger-test-${Date.now()}-${Math.random()}` },
    });
    await ensureWallet(db, { organizationId: organization.id, now });
    return organization.id;
  }

  it("refuses a reservation once every credit in the lot is spent", async () => {
    const organizationId = await grantedOrganization();
    for (let index = 0; index < 5; index += 1) {
      const candidateSessionId = `spend_${organizationId}_${index}`;
      expect((await reserveCreditForSession(db, { organizationId, candidateSessionId, now })).ok).toBe(
        true,
      );
      expect(
        (await captureReservationForSession(db, { organizationId, candidateSessionId, now })).outcome,
      ).toBe("captured");
    }

    expect(
      await reserveCreditForSession(db, {
        organizationId,
        candidateSessionId: `spend_${organizationId}_5`,
        now,
      }),
    ).toEqual({ ok: false, error: "no_credits_available" });

    const lot = await db.creditLot.findFirstOrThrow({ where: { organizationId } });
    expect(lot.status).toBe("exhausted");
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("sweeps holds that outlive the TTL and refuses to capture them afterwards", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `ttl_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });

    const afterTtl = new Date(now.getTime() + (RESERVATION_TTL_HOURS + 1) * HOUR_MS);
    expect(await releaseExpiredReservations(db, { organizationId, now: afterTtl })).toEqual({
      releasedCount: 1,
    });

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 5, reservedCredits: 0 });
    // A swept hold must never turn into a charge when the session finally reports.
    expect(
      (await captureReservationForSession(db, { organizationId, candidateSessionId, now: afterTtl }))
        .outcome,
    ).toBe("no_reservation");
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("reports a missing reservation as a value instead of throwing", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `unknown_${organizationId}`;
    expect(
      (await captureReservationForSession(db, { organizationId, candidateSessionId, now })).outcome,
    ).toBe("no_reservation");
    expect(
      (
        await releaseReservationForSession(db, {
          organizationId,
          candidateSessionId,
          now,
          reason: "never_started",
        })
      ).outcome,
    ).toBe("no_reservation");
  });

  it("does not resurrect credits when a hold is released after its lot fell due", async () => {
    // The expired-but-unswept state is produced through the clock alone — the lot
    // row keeps `status: "active"` and simply falls past `expiresAt`, which is
    // exactly the state a status-column check waves through.
    const organizationId = await grantedOrganization();
    const candidateSessionId = `late_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });

    const afterLotExpiry = new Date(now.getTime() + 30 * DAY_MS + 1000);
    const lotBefore = await db.creditLot.findFirstOrThrow({ where: { organizationId } });
    expect(lotBefore.status).toBe("active"); // still unswept
    expect(lotBefore.expiresAt.getTime()).toBeLessThan(afterLotExpiry.getTime());

    const released = await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId,
      now: afterLotExpiry,
      reason: "below_billable_threshold",
    });
    expect(released.outcome).toBe("released");

    // The returned credit must not become spendable again: the lot is dead, so the
    // release is immediately followed by the write-off of everything left in it.
    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 0 });
    const lotAfter = await db.creditLot.findFirstOrThrow({ where: { organizationId } });
    expect(lotAfter.status).toBe("expired");

    const ledger = await db.creditLedgerEntry.aggregate({
      where: { organizationId },
      _sum: { delta: true },
    });
    expect(ledger._sum.delta).toBe(wallet.availableCredits);
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);

    // And the wallet must never be driven negative by writing the same credit off twice.
    await expireDueLots(db, { organizationId, now: afterLotExpiry });
    const settled = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(settled.availableCredits).toBe(0);
  });

  it("keeps an expired lot's live hold in the wallet totals", async () => {
    // The lot expires while a hold is still live: the sweep writes off only the
    // available credits and leaves `creditsReserved` intact, so the reserved credit
    // must survive in both the wallet row and the recomputed totals.
    const organizationId = await grantedOrganization();
    const candidateSessionId = `held_through_expiry_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });

    const afterLotExpiry = new Date(now.getTime() + 30 * DAY_MS + 1000);
    await expireDueLots(db, { organizationId, now: afterLotExpiry });

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 1 });
    const audit = await reconcileWallet(db, { organizationId });
    expect(audit).toMatchObject({
      consistent: true,
      expected: { available: 0, reserved: 1 },
      actual: { available: 0, reserved: 1 },
    });
  });

  it("mints no phantom credit when two holds on a due lot are both released", async () => {
    // The second release is the dangerous one: the first release's trailing sweep
    // closes the lot, so the second finds it already `expired` and the sweep can no
    // longer write anything off. Everything here is produced by the clock and the
    // ordinary release path — no external actor, no forced status.
    const organizationId = await grantedOrganization();
    const first = `pair_a_${organizationId}`;
    const second = `pair_b_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId: first, now });
    await reserveCreditForSession(db, { organizationId, candidateSessionId: second, now });
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 3, reservedCredits: 2 });

    const afterLotExpiry = new Date(now.getTime() + 30 * DAY_MS + 1000);
    for (const candidateSessionId of [first, second]) {
      const released = await releaseReservationForSession(db, {
        organizationId,
        candidateSessionId,
        now: afterLotExpiry,
        reason: "below_billable_threshold",
      });
      expect(released.outcome).toBe("released");
    }

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 0 });
    const audit = await reconcileWallet(db, { organizationId });
    expect(audit).toMatchObject({
      consistent: true,
      expected: { available: 0, reserved: 0 },
      actual: { available: 0, reserved: 0 },
    });
    const ledger = await db.creditLedgerEntry.aggregate({
      where: { organizationId },
      _sum: { delta: true },
    });
    expect(ledger._sum.delta).toBe(0);
    // The phantom would be spendable-looking on the wallet but backed by no lot.
    expect(
      await reserveCreditForSession(db, {
        organizationId,
        candidateSessionId: `pair_c_${organizationId}`,
        now: afterLotExpiry,
      }),
    ).toEqual({ ok: false, error: "no_credits_available" });
  });

  it("mints no phantom credit when the lot was swept before the release", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `swept_first_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });

    const afterLotExpiry = new Date(now.getTime() + 30 * DAY_MS + 1000);
    // An external sweep closes the lot while the hold is still live.
    expect(
      (await expireDueLots(db, { organizationId, now: afterLotExpiry })).expiredLotIds,
    ).toHaveLength(1);
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 0, reservedCredits: 1 });

    const released = await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId,
      now: afterLotExpiry,
      reason: "below_billable_threshold",
    });
    expect(released.outcome).toBe("released");

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 0 });
    const audit = await reconcileWallet(db, { organizationId });
    expect(audit).toMatchObject({
      consistent: true,
      expected: { available: 0, reserved: 0 },
      actual: { available: 0, reserved: 0 },
    });
    const ledger = await db.creditLedgerEntry.aggregate({
      where: { organizationId },
      _sum: { delta: true },
    });
    expect(ledger._sum.delta).toBe(0);
  });

  it("compensates a TTL sweep that releases holds into an already-closed lot", async () => {
    // Same hazard on the sweep path, where several holds are released in one pass:
    // the wallet increment must count only the releases that returned a spendable
    // credit, not the number of reservations released.
    const organizationId = await grantedOrganization();
    await reserveCreditForSession(db, {
      organizationId,
      candidateSessionId: `ttl_pair_a_${organizationId}`,
      now,
    });
    await reserveCreditForSession(db, {
      organizationId,
      candidateSessionId: `ttl_pair_b_${organizationId}`,
      now,
    });

    const afterLotExpiry = new Date(now.getTime() + 30 * DAY_MS + 1000);
    await expireDueLots(db, { organizationId, now: afterLotExpiry });
    expect(
      await releaseExpiredReservations(db, { organizationId, now: afterLotExpiry }),
    ).toEqual({ releasedCount: 2 });

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 0 });
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("re-holds a released reservation instead of granting a free interview", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `rehold_${organizationId}`;

    const first = await reserveCreditForSession(db, { organizationId, candidateSessionId, now });
    expect(first.ok).toBe(true);
    await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId,
      now,
      reason: "below_billable_threshold",
    });
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 5, reservedCredits: 0 });

    // Restarting the session must take a fresh hold, not ride the released one.
    const second = await reserveCreditForSession(db, { organizationId, candidateSessionId, now });
    expect(second.ok).toBe(true);
    const reservation = await db.creditReservation.findUniqueOrThrow({
      where: { candidateSessionId },
    });
    expect(reservation).toMatchObject({ status: "held", resolvedAt: null });
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 4, reservedCredits: 1 });

    // …and it is charged exactly once, not twice.
    expect(
      (await captureReservationForSession(db, { organizationId, candidateSessionId, now })).outcome,
    ).toBe("captured");
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 4, reservedCredits: 0 });
    expect(await db.creditReservation.count({ where: { organizationId } })).toBe(1);
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("renews a resumed hold that has already outlived its TTL", async () => {
    // The composed flow the `held` short-circuit used to lose: admitted at T0, the
    // candidate comes back at T0 + (TTL + 1h) — past the hold's TTL. Everything
    // here is produced by the clock and
    // the ordinary reserve path — the reservation row is never touched by hand, so
    // the state under test is exactly the one production reaches. Without the
    // renewal the interview runs on a hold the organization's next admission sweeps
    // away, and the capture that follows finds `released` and never charges.
    const organizationId = await grantedOrganization();
    const candidateSessionId = `resume_past_ttl_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });

    const resumedAt = new Date(now.getTime() + (RESERVATION_TTL_HOURS + 1) * HOUR_MS);
    const admitted = await db.creditReservation.findUniqueOrThrow({
      where: { candidateSessionId },
    });
    // Due, and still unswept — the precondition, asserted rather than assumed.
    expect(admitted.status).toBe("held");
    expect(admitted.expiresAt.getTime()).toBeLessThan(resumedAt.getTime());

    const resumed = await reserveCreditForSession(db, {
      organizationId,
      candidateSessionId,
      now: resumedAt,
    });
    expect(resumed).toEqual({ ok: true, reservationId: admitted.id });

    const renewed = await db.creditReservation.findUniqueOrThrow({
      where: { candidateSessionId },
    });
    expect(renewed.status).toBe("held");
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(resumedAt.getTime());
    // `heldAt` records when the credit was first taken and must survive the renewal.
    expect(renewed.heldAt.getTime()).toBe(now.getTime());

    // The renewed hold now survives the sweep that would have released it…
    expect(await releaseExpiredReservations(db, { organizationId, now: resumedAt })).toEqual({
      releasedCount: 0,
    });
    // …so the interview it backs is still billable when it finishes.
    expect(
      (await captureReservationForSession(db, { organizationId, candidateSessionId, now: resumedAt }))
        .outcome,
    ).toBe("captured");
    expect(
      await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
    ).toMatchObject({ availableCredits: 4, reservedCredits: 0 });
    // One debit, not two: the resume renewed the hold, it did not buy another.
    expect(
      await db.creditLedgerEntry.count({ where: { organizationId, type: "reserve" } }),
    ).toBe(1);
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("refuses to re-hold a released reservation when the wallet is empty", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `rehold_empty_${organizationId}`;

    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });
    await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId,
      now,
      reason: "below_billable_threshold",
    });
    // Drain the wallet with five other sessions.
    for (let index = 0; index < 5; index += 1) {
      const other = `drain_${organizationId}_${index}`;
      expect((await reserveCreditForSession(db, { organizationId, candidateSessionId: other, now })).ok).toBe(
        true,
      );
      await captureReservationForSession(db, { organizationId, candidateSessionId: other, now });
    }

    expect(await reserveCreditForSession(db, { organizationId, candidateSessionId, now })).toEqual({
      ok: false,
      error: "no_credits_available",
    });
    const reservation = await db.creditReservation.findUniqueOrThrow({
      where: { candidateSessionId },
    });
    expect(reservation.status).toBe("released");
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  it("fails loudly instead of skipping the lock when no wallet exists", async () => {
    const organization = await db.organization.create({
      data: { name: `ledger-nowallet-${Date.now()}-${Math.random()}` },
    });
    await expect(
      expireDueLots(db, { organizationId: organization.id, now }),
    ).rejects.toThrow(MissingCreditWalletError);
  });

  it("grants First Five exactly once under concurrent ensureWallet calls", async () => {
    const organization = await db.organization.create({
      data: { name: `ledger-race-${Date.now()}-${Math.random()}` },
    });
    const organizationId = organization.id;

    const walletIds = await Promise.all(
      Array.from({ length: 6 }, () => ensureWallet(db, { organizationId, now })),
    );
    expect(new Set(walletIds.map((entry) => entry.walletId)).size).toBe(1);
    expect(await db.creditLot.count({ where: { organizationId } })).toBe(1);
    expect(await db.creditLedgerEntry.count({ where: { organizationId } })).toBe(1);
    expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
  });

  // The other direction of the money path: credits arriving. Stripe redelivers,
  // retries and sends the same fact under several event types, so "one payment
  // buys one lot" has to hold against repetition rather than assume its absence.
  describe("grantPurchasedCreditLot", () => {
    // A purchase is allowed to be an organization's *first* billing touch, which
    // `grantedOrganization` (it calls `ensureWallet`) would hide.
    async function organizationWithoutWallet(label: string): Promise<string> {
      const organization = await db.organization.create({
        data: { name: `ledger-${label}-${Date.now()}-${Math.random()}` },
      });
      return organization.id;
    }

    it("grants a paid lot with its own 12-month expiry and a pack_purchase entry", async () => {
      const organizationId = await organizationWithoutWallet("buy");
      const stripeEventId = `evt_test_${organizationId}`;
      const granted = await grantPurchasedCreditLot(db, {
        organizationId,
        packId: "hiring_100",
        creditsGranted: 100,
        unitAmountCents: 34900,
        currency: "EUR",
        stripePaymentIntentId: `pi_test_${organizationId}`,
        stripeCheckoutSessionId: `cs_test_${organizationId}`,
        stripeEventId,
        now,
      });

      const lot = await db.creditLot.findFirstOrThrow({
        where: { organizationId, source: "pack_purchase" },
      });
      expect(granted).toEqual({ outcome: "granted", lotId: lot.id });
      expect(lot).toMatchObject({
        kind: "paid",
        status: "active",
        packId: "hiring_100",
        creditsGranted: 100,
        unitAmountCents: 34900,
        currency: "EUR",
      });
      expect(lot.grantedAt.getTime()).toBe(now.getTime());
      // Paid credits carry their own clock: 12 months, not the free grant's 30 days.
      expect(lot.expiresAt.getTime()).toBe(now.getTime() + PAID_CREDIT_EXPIRY_DAYS * DAY_MS);

      const entry = await db.creditLedgerEntry.findFirstOrThrow({
        where: { organizationId, type: "pack_purchase" },
      });
      expect(entry).toMatchObject({ lotId: lot.id, delta: 100, stripeEventId });

      // Buying before any admission also materialises the wallet and First Five —
      // and, because this wallet is created *by* the purchase, the free lot aligns
      // on the paid lot's 12 months instead of dying at J+30 under a paying
      // customer (plan amendment 19).
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet.availableCredits).toBe(100 + FIRST_FIVE_CREDITS);
      const freeLot = await db.creditLot.findFirstOrThrow({
        where: { organizationId, source: "first_five" },
      });
      expect(freeLot.expiresAt.getTime()).toBe(now.getTime() + PAID_CREDIT_EXPIRY_DAYS * DAY_MS);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("keeps the 30-day First Five clock when the wallet predates the purchase", async () => {
      // The mirror case of the alignment above: this organization met billing at
      // its first admission, so its free grant has been ticking since then and a
      // later purchase must not silently extend it.
      const organizationId = await grantedOrganization();
      const granted = await grantPurchasedCreditLot(db, {
        organizationId,
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        stripePaymentIntentId: `pi_existing_${organizationId}`,
        stripeCheckoutSessionId: `cs_existing_${organizationId}`,
        now,
      });
      expect(granted.outcome).toBe("granted");

      const freeLot = await db.creditLot.findFirstOrThrow({
        where: { organizationId, source: "first_five" },
      });
      expect(freeLot.expiresAt.getTime()).toBe(now.getTime() + FIRST_FIVE_EXPIRY_DAYS * DAY_MS);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet.availableCredits).toBe(25 + FIRST_FIVE_CREDITS);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("is idempotent on the payment intent: the same payment delivered twice grants once", async () => {
      const organizationId = await organizationWithoutWallet("dup");
      const stripePaymentIntentId = `pi_dup_${organizationId}`;
      const input = {
        organizationId,
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        stripePaymentIntentId,
        stripeCheckoutSessionId: `cs_dup_${organizationId}`,
        now,
      };
      const first = await grantPurchasedCreditLot(db, input);
      const second = await grantPurchasedCreditLot(db, input);
      expect([first.outcome, second.outcome]).toEqual(["granted", "already_granted"]);

      // Redelivery is rarely polite enough to wait for the first call to return:
      // two workers handed the same event at once serialise on the wallet lock and
      // the loser rolls back whole, so it reports the fact instead of a second lot.
      const racedIntent = `pi_dup_race_${organizationId}`;
      const racedInput = {
        ...input,
        stripePaymentIntentId: racedIntent,
        stripeCheckoutSessionId: `cs_dup_race_${organizationId}`,
      };
      const raced = await Promise.all([
        grantPurchasedCreditLot(db, racedInput),
        grantPurchasedCreditLot(db, racedInput),
      ]);
      expect(raced.map((result) => result.outcome).sort()).toEqual([
        "already_granted",
        "granted",
      ]);

      expect(await db.creditLot.count({ where: { stripePaymentIntentId } })).toBe(1);
      expect(await db.creditLot.count({ where: { stripePaymentIntentId: racedIntent } })).toBe(1);
      // Four deliveries, two payments, two credited lines.
      expect(
        await db.creditLedgerEntry.count({ where: { organizationId, type: "pack_purchase" } }),
      ).toBe(2);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet.availableCredits).toBe(25 + 25 + FIRST_FIVE_CREDITS);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("rethrows a unique violation that is not this payment's", async () => {
      const organizationId = await organizationWithoutWallet("collision");
      const shared = {
        organizationId,
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        stripeCheckoutSessionId: `cs_shared_${organizationId}`,
        now,
      };
      expect(
        (
          await grantPurchasedCreditLot(db, {
            ...shared,
            stripePaymentIntentId: `pi_collide_a_${organizationId}`,
          })
        ).outcome,
      ).toBe("granted");

      // Same checkout session, a *different* payment intent. The unique violation
      // this raises says nothing about the payment being credited, and reporting
      // `already_granted` would answer Stripe 200 — ending the retries on a payment
      // no lot backs. It must surface.
      await expect(
        grantPurchasedCreditLot(db, {
          ...shared,
          stripePaymentIntentId: `pi_collide_b_${organizationId}`,
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      expect(
        await db.creditLot.count({ where: { organizationId, source: "pack_purchase" } }),
      ).toBe(1);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet.availableCredits).toBe(25 + FIRST_FIVE_CREDITS);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("refuses to report a replay as granted when the credits went to another organization", async () => {
      const buyer = await organizationWithoutWallet("owner");
      const stranger = await organizationWithoutWallet("stranger");
      const stripePaymentIntentId = `pi_crossorg_${buyer}`;
      const paid = {
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        stripePaymentIntentId,
        now,
      };
      expect(
        (await grantPurchasedCreditLot(db, { ...paid, organizationId: buyer })).outcome,
      ).toBe("granted");

      // The payment intent is unique across the whole table, so the idempotence
      // re-read can hand back a lot belonging to someone else. Answering
      // `already_granted` here would leave this organization uncredited while
      // Stripe is told to stop retrying — and both wallets would still reconcile,
      // which is what makes it silent. It must fail loudly instead.
      await expect(
        grantPurchasedCreditLot(db, { ...paid, organizationId: stranger }),
      ).rejects.toMatchObject({ code: "P2002" });

      expect(
        await db.creditLot.count({ where: { organizationId: stranger, source: "pack_purchase" } }),
      ).toBe(0);
      // The refused caller still gets the wallet `ensureWallet` opened for it —
      // five free credits and not one bought credit more.
      const strangerWallet = await db.creditWallet.findUniqueOrThrow({
        where: { organizationId: stranger },
      });
      expect(strangerWallet).toMatchObject({
        availableCredits: FIRST_FIVE_CREDITS,
        reservedCredits: 0,
      });
      const buyerWallet = await db.creditWallet.findUniqueOrThrow({
        where: { organizationId: buyer },
      });
      expect(buyerWallet.availableCredits).toBe(25 + FIRST_FIVE_CREDITS);
      expect((await reconcileWallet(db, { organizationId: buyer })).consistent).toBe(true);
      expect((await reconcileWallet(db, { organizationId: stranger })).consistent).toBe(true);
    });

    it("refuses a purchase that grants nothing, before it writes anything", async () => {
      const organizationId = await organizationWithoutWallet("empty-purchase");
      const paid = {
        organizationId,
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        now,
      };

      await expect(
        grantPurchasedCreditLot(db, {
          ...paid,
          creditsGranted: 0,
          stripePaymentIntentId: `pi_zero_${organizationId}`,
        }),
      ).rejects.toThrow(InvalidCreditPurchaseAmountError);
      await expect(
        grantPurchasedCreditLot(db, {
          ...paid,
          creditsGranted: -25,
          stripePaymentIntentId: `pi_negative_${organizationId}`,
        }),
      ).rejects.toThrow(InvalidCreditPurchaseAmountError);
      await expect(
        grantPurchasedCreditLot(db, {
          ...paid,
          unitAmountCents: -1,
          stripePaymentIntentId: `pi_negative_amount_${organizationId}`,
        }),
      ).rejects.toThrow(InvalidCreditPurchaseAmountError);

      // "Before any write" is the point of the guard: the ledger is append-only, so
      // a bad grant is only undone by a compensating entry. Not even the wallet
      // exists after three refusals.
      expect(await db.creditWallet.findUnique({ where: { organizationId } })).toBeNull();
      expect(await db.creditLot.count({ where: { organizationId } })).toBe(0);
      expect(await db.creditLedgerEntry.count({ where: { organizationId } })).toBe(0);
    });

    it("records the currency that was actually paid instead of defaulting to EUR", async () => {
      const organizationId = await organizationWithoutWallet("usd");
      const paid = {
        organizationId,
        packId: "hiring_100",
        creditsGranted: 100,
        unitAmountCents: 34900, // $349.00 — cents of the currency below, never converted
        now,
      };
      await grantPurchasedCreditLot(db, {
        ...paid,
        currency: "USD",
        stripePaymentIntentId: `pi_usd_${organizationId}`,
        stripeCheckoutSessionId: `cs_usd_${organizationId}`,
      });
      // Stripe reports `session.currency` lower-cased; the column is upper-case.
      await grantPurchasedCreditLot(db, {
        ...paid,
        currency: "usd",
        stripePaymentIntentId: `pi_usd_lower_${organizationId}`,
        stripeCheckoutSessionId: `cs_usd_lower_${organizationId}`,
      });

      const lots = await db.creditLot.findMany({
        where: { organizationId, source: "pack_purchase" },
      });
      expect(lots.map((lot) => lot.currency)).toEqual(["USD", "USD"]);
      expect(lots.map((lot) => lot.unitAmountCents)).toEqual([34900, 34900]);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("grants a payment that carries no checkout session", async () => {
      // The Phase 3 shape (a payment intent charged against a stored mandate) has
      // no Checkout session at all. Two of them must coexist, which they only do
      // if the column is left NULL rather than filled with a placeholder — every
      // Stripe id on the lot sits under a unique index.
      const organizationId = await organizationWithoutWallet("no-session");
      const paid = {
        organizationId,
        packId: "starter_25",
        creditsGranted: 25,
        unitAmountCents: 9900,
        currency: "EUR",
        now,
      };
      const first = await grantPurchasedCreditLot(db, {
        ...paid,
        stripePaymentIntentId: `pi_nosession_a_${organizationId}`,
      });
      const second = await grantPurchasedCreditLot(db, {
        ...paid,
        stripePaymentIntentId: `pi_nosession_b_${organizationId}`,
      });
      expect([first.outcome, second.outcome]).toEqual(["granted", "granted"]);

      const lots = await db.creditLot.findMany({
        where: { organizationId, source: "pack_purchase" },
      });
      expect(lots.map((lot) => lot.stripeCheckoutSessionId)).toEqual([null, null]);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet.availableCredits).toBe(25 + 25 + FIRST_FIVE_CREDITS);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });
  });

  // The tests above establish what the ledger does when it is asked one thing at a
  // time. The ones below are the reason the wallet row lock exists: they are the
  // claim a reviewer should be able to reject on its own. Each fails the moment a
  // balance read escapes the transaction or a statement is reordered past the
  // `FOR UPDATE` — which is exactly what an "optimistic, we'll check the counter
  // first" refactor would do.
  //
  // The fourth concurrency property — a race on `ensureWallet` grants First Five
  // once — is already proven above by "grants First Five exactly once under
  // concurrent ensureWallet calls" (6 racers, and it also pins the single ledger
  // entry), so it is deliberately not repeated here.
  describe("under concurrency", () => {
    // Spends the grant down to `credits` through the ordinary reserve → capture
    // path. Editing `creditsGranted` by hand would be quicker but would leave the
    // `free_grant` entry claiming five, and `reconcileWallet` audits the ledger sum
    // against the wallet — the fixture would then poison the assertion it is meant
    // to support. So the balance is produced the way a customer produces it.
    async function organizationWithCredits(credits: number): Promise<string> {
      const organizationId = await grantedOrganization();
      for (let index = 0; index < FIRST_FIVE_CREDITS - credits; index += 1) {
        const candidateSessionId = `spend_down_${organizationId}_${index}`;
        await reserveCreditForSession(db, { organizationId, candidateSessionId, now });
        await captureReservationForSession(db, { organizationId, candidateSessionId, now });
      }
      expect(
        await db.creditWallet.findUniqueOrThrow({ where: { organizationId } }),
      ).toMatchObject({ availableCredits: credits, reservedCredits: 0 });
      return organizationId;
    }

    it("never over-reserves: ten parallel admissions against three credits hold exactly three", async () => {
      const credits = 3;
      // The fixture spends the rest of the grant down, and each of those spend-downs
      // writes a `reserve` line of its own — named here so that changing `credits`
      // moves the fixture's contribution instead of reading as an over-reservation.
      const spentDownByFixture = FIRST_FIVE_CREDITS - credits;
      const admissions = MAX_TEST_PARALLELISM;
      const organizationId = await organizationWithCredits(credits);

      const attempts = await Promise.all(
        Array.from({ length: admissions }, (_, index) =>
          reserveCreditForSession(db, {
            organizationId,
            candidateSessionId: `conc_${organizationId}_${index}`,
            now,
          }),
        ),
      );
      expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(credits);
      // The losers must be told *why*, not silently handed a hold: a refusal that is
      // not `no_credits_available` would mean the lock leaked an error.
      expect(attempts.filter((attempt) => !attempt.ok)).toEqual(
        Array.from({ length: admissions - credits }, () => ({
          ok: false,
          error: "no_credits_available",
        })),
      );
      // Three *distinct* reservations — not one id handed out three times.
      const reservationIds = attempts.flatMap((attempt) =>
        attempt.ok ? [attempt.reservationId] : [],
      );
      expect(new Set(reservationIds).size).toBe(credits);

      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: credits });
      expect(
        await db.creditReservation.count({ where: { organizationId, status: "held" } }),
      ).toBe(credits);
      // Ten admissions, three `reserve` lines: the ledger cannot have recorded a
      // debit for a hold that was refused.
      expect(
        await db.creditLedgerEntry.count({ where: { organizationId, type: "reserve" } }),
      ).toBe(credits + spentDownByFixture);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("admits exactly one of two candidates racing for the last credit", async () => {
      // The minimal race, and the one most likely to survive a careless refactor of
      // the ten-way test above: with a single credit left there is no slack at all,
      // so any window between reading the balance and taking the hold shows up as
      // two winners.
      const organizationId = await organizationWithCredits(1);

      const results = await Promise.all([
        reserveCreditForSession(db, {
          organizationId,
          candidateSessionId: `last_a_${organizationId}`,
          now,
        }),
        reserveCreditForSession(db, {
          organizationId,
          candidateSessionId: `last_b_${organizationId}`,
          now,
        }),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results).toContainEqual({ ok: false, error: "no_credits_available" });

      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 1 });
      expect(
        await db.creditReservation.count({ where: { organizationId, status: "held" } }),
      ).toBe(1);
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("is resume-safe: reserving twice for one session holds exactly one credit", async () => {
      // A candidate who reloads the page, and a candidate whose two tabs hit the
      // room at the same instant. Both must cost one credit, not two — and the
      // second call must return the *same* hold, not a fresh one.
      const organizationId = await grantedOrganization();
      const reload = `resume_${organizationId}`;

      const first = await reserveCreditForSession(db, {
        organizationId,
        candidateSessionId: reload,
        now,
      });
      const second = await reserveCreditForSession(db, {
        organizationId,
        candidateSessionId: reload,
        now,
      });
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);

      const twoTabs = `resume_parallel_${organizationId}`;
      const raced = await Promise.all([
        reserveCreditForSession(db, { organizationId, candidateSessionId: twoTabs, now }),
        reserveCreditForSession(db, { organizationId, candidateSessionId: twoTabs, now }),
      ]);
      expect(raced[0].ok).toBe(true);
      expect(raced[1]).toEqual(raced[0]);

      // Two sessions, two reservation rows, two credits — four calls.
      expect(await db.creditReservation.count({ where: { organizationId } })).toBe(2);
      expect(
        await db.creditLedgerEntry.count({ where: { organizationId, type: "reserve" } }),
      ).toBe(2);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet).toMatchObject({ availableCredits: 3, reservedCredits: 2 });
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });

    it("captures at most once when the same completion is delivered twice", async () => {
      const organizationId = await grantedOrganization();
      const redelivered = `capture_twice_${organizationId}`;
      await reserveCreditForSession(db, { organizationId, candidateSessionId: redelivered, now });

      const first = await captureReservationForSession(db, {
        organizationId,
        candidateSessionId: redelivered,
        now,
      });
      const second = await captureReservationForSession(db, {
        organizationId,
        candidateSessionId: redelivered,
        now,
      });
      expect(first.outcome).toBe("captured");
      expect(second.outcome).toBe("already_captured");

      // Redelivery is rarely polite enough to arrive after the first call returned:
      // two workers reporting the same session at once must still charge once, and
      // the loser must say so rather than report a second capture.
      const concurrent = `capture_race_${organizationId}`;
      await reserveCreditForSession(db, { organizationId, candidateSessionId: concurrent, now });
      const raced = await Promise.all([
        captureReservationForSession(db, { organizationId, candidateSessionId: concurrent, now }),
        captureReservationForSession(db, { organizationId, candidateSessionId: concurrent, now }),
      ]);
      expect(raced.map((result) => result.outcome).sort()).toEqual([
        "already_captured",
        "captured",
      ]);

      const lot = await db.creditLot.findFirstOrThrow({ where: { organizationId } });
      expect(lot).toMatchObject({ creditsConsumed: 2, creditsReserved: 0 });
      expect(
        await db.creditLedgerEntry.count({ where: { organizationId, type: "consume" } }),
      ).toBe(2);
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      expect(wallet).toMatchObject({ availableCredits: 3, reservedCredits: 0 });
      expect((await reconcileWallet(db, { organizationId })).consistent).toBe(true);
    });
  });
});
