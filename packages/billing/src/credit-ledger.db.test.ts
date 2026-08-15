import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  MissingCreditWalletError,
  reconcileWallet,
  releaseExpiredReservations,
  releaseReservationForSession,
  reserveCreditForSession,
} from "./credit-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
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

    const afterTtl = new Date(now.getTime() + 13 * 60 * 60 * 1000);
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
});
