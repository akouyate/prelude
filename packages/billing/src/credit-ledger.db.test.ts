import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  reconcileWallet,
  releaseExpiredReservations,
  releaseReservationForSession,
  reserveCreditForSession,
} from "./credit-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("credit ledger (Postgres)", () => {
  let db: PrismaClient;
  let organizationId: string;
  const now = new Date("2026-08-14T12:00:00.000Z");

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
      now: new Date("2026-09-14T12:00:01.000Z"), // 30 days + ε after the grant
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

  it("does not resurrect credits when a hold is released into a closed lot", async () => {
    const organizationId = await grantedOrganization();
    const candidateSessionId = `closed_${organizationId}`;
    await reserveCreditForSession(db, { organizationId, candidateSessionId, now });
    await db.creditLot.updateMany({ where: { organizationId }, data: { status: "expired" } });

    const before = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId,
      now,
      reason: "below_billable_threshold",
    });
    const after = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });

    expect(after.availableCredits).toBe(before.availableCredits);
    expect(after.reservedCredits).toBe(0);
    const ledger = await db.creditLedgerEntry.aggregate({
      where: { organizationId },
      _sum: { delta: true },
    });
    expect(ledger._sum.delta).toBe(after.availableCredits);
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
