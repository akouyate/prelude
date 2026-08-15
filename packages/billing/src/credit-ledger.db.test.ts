import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  FIRST_FIVE_CREDITS,
  MissingCreditWalletError,
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
