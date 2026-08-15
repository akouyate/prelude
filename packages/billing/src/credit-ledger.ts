import {
  availableInLot,
  computeWalletTotals,
  selectLotForReservation,
  type CreditLotSnapshot,
} from "@prelude/core";
import { Prisma, type PrismaClient } from "@prelude/db";

/**
 * Transactional credit ledger.
 *
 * Money rules that hold everywhere in this module:
 *  - every mutating function runs exactly one interactive transaction whose first
 *    statement takes the per-organization `CreditWallet` row lock (`FOR UPDATE`),
 *    which serialises all credit operations for that organization and brings the
 *    balance read *inside* the transaction;
 *  - `CreditLedgerEntry` is append-only — this module never updates or deletes one;
 *  - `delta` is the signed change to *available* credits:
 *    `free_grant +N`, `pack_purchase +N`, `reserve −1`, `release +1`, `consume 0`,
 *    `expire −remaining`;
 *  - a counter change and the ledger entry that explains it are always written in
 *    the same transaction, never split.
 */

export const FIRST_FIVE_CREDITS = 5;
export const FIRST_FIVE_EXPIRY_DAYS = 30;
export const RESERVATION_TTL_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Interactive-transaction budget. The per-organization `FOR UPDATE` lock means a
 * caller can genuinely queue behind another credit operation, so both bounds are
 * explicit rather than left to Prisma's 2s/5s defaults: `MAX_WAIT` is how long we
 * are willing to wait for a connection from the pool, `TIMEOUT` is how long the
 * whole locked section may run before Postgres rolls it back.
 */
const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 15_000;
const TRANSACTION_OPTIONS = {
  maxWait: TRANSACTION_MAX_WAIT_MS,
  timeout: TRANSACTION_TIMEOUT_MS,
} as const;

/**
 * Serialising on a row lock trades write conflicts for lock waits, so P2028
 * (transaction expired / not started in time) is the failure mode this design
 * introduces. It is transient by nature — the holder commits and the queue drains —
 * so it gets a small jittered retry. No other error code is retried: a P2002, a
 * constraint violation or a business error must surface immediately.
 */
const TRANSACTION_RETRY_ATTEMPTS = 3;
const TRANSACTION_RETRY_BASE_DELAY_MS = 50;

/** Thrown when a credit operation runs against an organization that has no wallet. */
export class MissingCreditWalletError extends Error {
  readonly organizationId: string;

  constructor(organizationId: string) {
    super(`no credit wallet exists for organization ${organizationId}`);
    this.name = "MissingCreditWalletError";
    this.organizationId = organizationId;
  }
}

/** Thrown when a lot row carries a `kind` this module does not know how to price. */
export class UnknownCreditLotKindError extends Error {
  constructor(lotId: string, kind: string) {
    super(`credit lot ${lotId} has unknown kind ${JSON.stringify(kind)}`);
    this.name = "UnknownCreditLotKindError";
  }
}

export type ReserveCreditResult =
  | { ok: true; reservationId: string }
  | { ok: false; error: "no_credits_available" };

export type CaptureReservationResult = {
  outcome: "captured" | "already_captured" | "no_reservation";
};

export type ReleaseReservationResult = {
  outcome: "released" | "already_resolved" | "no_reservation";
};

export type WalletReconciliation = {
  consistent: boolean;
  expected: { available: number; reserved: number };
  actual: { available: number; reserved: number };
};

type LotRow = {
  id: string;
  kind: string;
  status: string;
  creditsGranted: number;
  creditsConsumed: number;
  creditsReserved: number;
  grantedAt: Date;
  expiresAt: Date;
};

type ReservationRow = {
  id: string;
  organizationId: string;
  candidateSessionId: string;
  lotId: string;
  status: string;
};

/**
 * Prisma stores `kind`/`status` as plain `String` columns, so rows arrive typed as
 * `string`. This is the single place where the database representation is narrowed
 * to the domain type consumed by `@prelude/core` — no `as` casts anywhere else.
 *
 * The two columns fail in opposite directions on purpose. An unknown `kind` throws:
 * `kind` decides consumption order (free is spent before paid), so guessing would
 * silently spend the wrong money — a money module must refuse. An unknown `status`
 * maps to `revoked`, which is non-spendable, so it fails closed.
 */
function toLotSnapshot(row: LotRow): CreditLotSnapshot {
  return {
    id: row.id,
    kind: toLotKind(row.id, row.kind),
    status: toLotStatus(row.status),
    creditsGranted: row.creditsGranted,
    creditsConsumed: row.creditsConsumed,
    creditsReserved: row.creditsReserved,
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
  };
}

function toLotKind(lotId: string, value: string): CreditLotSnapshot["kind"] {
  switch (value) {
    case "free":
    case "paid":
      return value;
    default:
      throw new UnknownCreditLotKindError(lotId, value);
  }
}

function toLotStatus(value: string): CreditLotSnapshot["status"] {
  switch (value) {
    case "active":
    case "exhausted":
    case "expired":
    case "frozen":
    case "revoked":
      return value;
    default:
      return "revoked";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTransactionExpired(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one interactive transaction with the explicit budget above, retrying only
 * P2028 with a jittered backoff.
 */
async function runTransaction<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSACTION_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (!isTransactionExpired(error)) {
        throw error;
      }
      lastError = error;
      if (attempt < TRANSACTION_RETRY_ATTEMPTS) {
        await sleep(TRANSACTION_RETRY_BASE_DELAY_MS * attempt * (0.5 + Math.random()));
      }
    }
  }
  throw lastError;
}

/**
 * The one entry point for every credit mutation. Routing all of them through here
 * is what makes "the first statement is the wallet `FOR UPDATE`" structural rather
 * than a convention each function has to remember.
 */
function runInWalletTransaction<T>(
  db: PrismaClient,
  organizationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runTransaction(db, async (tx) => {
    await lockWallet(tx, organizationId);
    return work(tx);
  });
}

/**
 * The serialisation point of the whole system. Taking the wallet row lock first
 * means every later read in the transaction (lots, reservations, balances) sees a
 * state no other credit operation for this organization can be mutating.
 *
 * `FOR UPDATE` on a row that does not exist locks nothing and silently succeeds, so
 * an absent wallet would quietly downgrade every caller to no serialisation at all.
 * The row count is therefore checked and the absent case fails loudly.
 */
async function lockWallet(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const walletId = await tryLockWallet(tx, organizationId);
  if (!walletId) {
    throw new MissingCreditWalletError(organizationId);
  }
  return walletId;
}

/** The same lock for the one caller that legitimately runs before a wallet exists. */
async function tryLockWallet(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "CreditWallet" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
  return rows[0]?.id ?? null;
}

async function loadLots(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<CreditLotSnapshot[]> {
  const rows = await tx.creditLot.findMany({
    where: { organizationId, status: "active" },
  });
  return rows.map(toLotSnapshot);
}

/**
 * Creates the wallet and, co-transactionally, the `first_five` lot plus its
 * `free_grant` ledger entry.
 *
 * Deliberate deviation from #140's "grant on organization creation": the grant
 * happens lazily on the first billing touch. Organizations are created at four
 * different call sites; hooking all of them is fragile, a customer cannot observe a
 * wallet before touching billing, and starting the 30-day clock at first use is
 * strictly friendlier. Pre-launch organizations get their grant the same way.
 *
 * `organizationId @unique` on the wallet is what makes the grant race-safe: the lot
 * is only ever written together with the wallet row, so the loser of a concurrent
 * create hits P2002, re-reads and returns the winner's wallet.
 */
export async function ensureWallet(
  db: PrismaClient,
  input: { organizationId: string; now: Date },
): Promise<{ walletId: string }> {
  const { organizationId, now } = input;

  const existing = await db.creditWallet.findUnique({ where: { organizationId } });
  if (existing) {
    return { walletId: existing.id };
  }

  try {
    return await runTransaction(db, async (tx) => {
      // The only caller that may legitimately find no wallet to lock — it is the
      // one creating it. The `organizationId @unique` constraint, not the lock, is
      // what makes this race-safe.
      const lockedWalletId = await tryLockWallet(tx, organizationId);
      // Re-check under the lock: a concurrent transaction may have committed the
      // wallet between the read above and this transaction starting.
      if (lockedWalletId) {
        return { walletId: lockedWalletId };
      }

      const wallet = await tx.creditWallet.create({
        data: {
          organizationId,
          availableCredits: FIRST_FIVE_CREDITS,
          reservedCredits: 0,
        },
      });
      const lot = await tx.creditLot.create({
        data: {
          organizationId,
          kind: "free",
          source: "first_five",
          creditsGranted: FIRST_FIVE_CREDITS,
          status: "active",
          grantedAt: now,
          expiresAt: new Date(now.getTime() + FIRST_FIVE_EXPIRY_DAYS * DAY_MS),
        },
      });
      await tx.creditLedgerEntry.create({
        data: {
          organizationId,
          lotId: lot.id,
          type: "free_grant",
          delta: FIRST_FIVE_CREDITS,
          actorKind: "system",
          reason: "first_five",
        },
      });

      return { walletId: wallet.id };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
      return { walletId: wallet.id };
    }
    throw error;
  }
}

/**
 * Holds one credit for a candidate session. Resume-safe and charged at most once
 * *per hold*: a session whose hold is still live or already captured short-circuits,
 * while a session whose hold was given back must acquire a fresh one before it can
 * run again — otherwise a released hold would buy a free interview.
 */
export async function reserveCreditForSession(
  db: PrismaClient,
  input: { organizationId: string; candidateSessionId: string; now: Date },
): Promise<ReserveCreditResult> {
  const { organizationId, candidateSessionId, now } = input;

  await ensureWallet(db, { organizationId, now });

  return runInWalletTransaction(db, organizationId, async (tx) => {
    const existing = await tx.creditReservation.findUnique({
      where: { candidateSessionId },
    });
    if (existing && existing.organizationId !== organizationId) {
      // Impossible by construction (candidate session ids are globally unique), so
      // this is a data-integrity failure rather than a business outcome. Fail loudly
      // instead of letting it surface as a raw unique-constraint violation below.
      throw new Error(
        `credit reservation ${existing.id} for candidate session ${candidateSessionId} belongs to another organization`,
      );
    }
    if (existing && (existing.status === "held" || existing.status === "captured")) {
      // `held`: the same hold is still live, so this is a resume.
      // `captured`: the credit is already spent for this session; re-charging would
      // be an unaudited second debit.
      return { ok: true as const, reservationId: existing.id };
    }

    // Opportunistic per-organization housekeeping, cheap under the lock we already
    // hold. TTL releases run *before* lot expiry so credits handed back by a stale
    // reservation land in their lot before that lot's remaining balance is written
    // off — otherwise the expiry write-off would miss them.
    await releaseExpiredReservationsInTx(tx, organizationId, now);
    await expireDueLotsInTx(tx, organizationId, now);

    const lot = selectLotForReservation(await loadLots(tx, organizationId), now);
    if (!lot) {
      return { ok: false as const, error: "no_credits_available" as const };
    }

    await tx.creditLot.update({
      where: { id: lot.id },
      data: { creditsReserved: { increment: 1 } },
    });
    const heldUntil = new Date(now.getTime() + RESERVATION_TTL_HOURS * HOUR_MS);
    const reservationData = {
      lotId: lot.id,
      status: "held",
      heldAt: now,
      expiresAt: heldUntil,
      resolvedAt: null,
    };
    // A released reservation is re-held on the row that already exists, because
    // `candidateSessionId @unique` leaves no room for a second one. The lot is
    // re-selected from scratch: the lot that backed the original hold may have
    // expired or run out in the meantime.
    const reservation = existing
      ? await tx.creditReservation.update({
          where: { id: existing.id },
          data: reservationData,
        })
      : await tx.creditReservation.create({
          data: { organizationId, candidateSessionId, ...reservationData },
        });
    await tx.creditLedgerEntry.create({
      data: {
        organizationId,
        lotId: lot.id,
        type: "reserve",
        delta: -1,
        candidateSessionId,
        actorKind: "system",
      },
    });
    await tx.creditWallet.update({
      where: { organizationId },
      data: { availableCredits: { decrement: 1 }, reservedCredits: { increment: 1 } },
    });

    return { ok: true as const, reservationId: reservation.id };
  });
}

/**
 * Turns a held reservation into a consumed credit. A session with no reservation is
 * a normal outcome (it was created while the flag was off), so it is reported as a
 * value and logged — never thrown.
 */
export async function captureReservationForSession(
  db: PrismaClient,
  input: { organizationId: string; candidateSessionId: string; now: Date },
): Promise<CaptureReservationResult> {
  const { organizationId, candidateSessionId, now } = input;

  return runInWalletTransaction(db, organizationId, async (tx) => {
    const reservation = await tx.creditReservation.findUnique({
      where: { candidateSessionId },
    });
    if (!reservation || reservation.organizationId !== organizationId) {
      console.warn("[credit-ledger] capture without reservation", { candidateSessionId });
      return { outcome: "no_reservation" as const };
    }
    if (reservation.status === "captured") {
      return { outcome: "already_captured" as const };
    }
    if (reservation.status !== "held") {
      // Released (not billable, or swept at TTL): there is nothing held to capture,
      // and the ledger has already settled this session.
      console.warn("[credit-ledger] capture without a held reservation", {
        candidateSessionId,
        status: reservation.status,
      });
      return { outcome: "no_reservation" as const };
    }

    const updatedLot = await tx.creditLot.update({
      where: { id: reservation.lotId },
      data: { creditsReserved: { decrement: 1 }, creditsConsumed: { increment: 1 } },
    });
    if (updatedLot.status === "active" && updatedLot.creditsConsumed >= updatedLot.creditsGranted) {
      await tx.creditLot.update({
        where: { id: updatedLot.id },
        data: { status: "exhausted" },
      });
    }
    await tx.creditReservation.update({
      where: { id: reservation.id },
      data: { status: "captured", resolvedAt: now },
    });
    await tx.creditLedgerEntry.create({
      data: {
        organizationId,
        lotId: reservation.lotId,
        type: "consume",
        delta: 0,
        candidateSessionId,
        actorKind: "system",
      },
    });
    // `consume` moves a credit from reserved to consumed: available is untouched
    // (delta 0), only the reserved counter falls.
    await tx.creditWallet.update({
      where: { organizationId },
      data: { reservedCredits: { decrement: 1 } },
    });

    return { outcome: "captured" as const };
  });
}

/**
 * Hands a held credit back (interview below the billable threshold, abandoned run,
 * recruiter cancellation…). Like capture, a missing reservation is a value.
 */
export async function releaseReservationForSession(
  db: PrismaClient,
  input: { organizationId: string; candidateSessionId: string; now: Date; reason: string },
): Promise<ReleaseReservationResult> {
  const { organizationId, candidateSessionId, now, reason } = input;

  return runInWalletTransaction(db, organizationId, async (tx) => {
    const reservation = await tx.creditReservation.findUnique({
      where: { candidateSessionId },
    });
    if (!reservation || reservation.organizationId !== organizationId) {
      console.warn("[credit-ledger] release without reservation", { candidateSessionId });
      return { outcome: "no_reservation" as const };
    }
    if (reservation.status !== "held") {
      return { outcome: "already_resolved" as const };
    }

    const availableDelta = await releaseReservationRow(tx, reservation, now, reason);
    await tx.creditWallet.update({
      where: { organizationId },
      data: {
        availableCredits: { increment: availableDelta },
        reservedCredits: { decrement: 1 },
      },
    });
    // The credit is back in a still-open lot that may have fallen due while it was
    // held; sweeping here writes it off. A lot that was already closed took the
    // compensating path inside `releaseReservationRow` and this sweep skips it.
    await expireDueLotsInTx(tx, organizationId, now);

    return { outcome: "released" as const };
  });
}

/** Sweeps holds that outlived `RESERVATION_TTL_HOURS` back into their lots. */
export async function releaseExpiredReservations(
  db: PrismaClient,
  input: { organizationId: string; now: Date },
): Promise<{ releasedCount: number }> {
  const { organizationId, now } = input;
  return runInWalletTransaction(db, organizationId, async (tx) => {
    const result = await releaseExpiredReservationsInTx(tx, organizationId, now);
    await expireDueLotsInTx(tx, organizationId, now);
    return result;
  });
}

/** Writes off lots whose `expiresAt` has passed. */
export async function expireDueLots(
  db: PrismaClient,
  input: { organizationId: string; now: Date },
): Promise<{ expiredLotIds: string[] }> {
  return runInWalletTransaction(db, input.organizationId, (tx) =>
    expireDueLotsInTx(tx, input.organizationId, input.now),
  );
}

/**
 * Read-only audit: recompute the wallet from the lots (the same policy the runtime
 * spends against) and from the ledger, and compare both with the stored counters.
 * It takes the same wallet lock so the three reads are a quiesced snapshot rather
 * than a torn one.
 *
 * The clock is the real one on purpose: the wallet row is supposed to describe the
 * organization's balance *now*, so a lot that is past `expiresAt` but not yet swept
 * is genuine drift and should be reported as such.
 */
export async function reconcileWallet(
  db: PrismaClient,
  input: { organizationId: string },
): Promise<WalletReconciliation> {
  const { organizationId } = input;
  const now = new Date();

  return runInWalletTransaction(db, organizationId, async (tx) => {
    // The lock above already threw if this organization has no wallet, so the row
    // is guaranteed to exist here.
    const wallet = await tx.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    const lotRows = await tx.creditLot.findMany({ where: { organizationId } });
    const ledgerSum = await tx.creditLedgerEntry.aggregate({
      where: { organizationId },
      _sum: { delta: true },
    });

    const totals = computeWalletTotals(lotRows.map(toLotSnapshot), now);
    const expected = { available: totals.available, reserved: totals.reserved };
    const actual = {
      available: wallet.availableCredits,
      reserved: wallet.reservedCredits,
    };
    const ledgerDelta = ledgerSum._sum.delta ?? 0;

    return {
      consistent:
        expected.available === actual.available &&
        expected.reserved === actual.reserved &&
        ledgerDelta === actual.available,
      expected,
      actual,
    };
  });
}

// ---------------------------------------------------------------------------
// In-transaction primitives. Each one assumes the wallet lock is already held.
// ---------------------------------------------------------------------------

async function releaseExpiredReservationsInTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<{ releasedCount: number }> {
  const due = await tx.creditReservation.findMany({
    where: { organizationId, status: "held", expiresAt: { lte: now } },
  });
  if (due.length === 0) {
    return { releasedCount: 0 };
  }

  // Holds in one sweep can sit on different lots, some still open and some already
  // closed, so the wallet increment is the number of releases that actually
  // returned a spendable credit — not the number of reservations released.
  let availableDelta = 0;
  for (const reservation of due) {
    availableDelta += await releaseReservationRow(
      tx,
      reservation,
      now,
      "reservation_ttl_expired",
    );
  }
  await tx.creditWallet.update({
    where: { organizationId },
    data: {
      availableCredits: { increment: availableDelta },
      reservedCredits: { decrement: due.length },
    },
  });

  return { releasedCount: due.length };
}

/**
 * Releases one held reservation and returns the change it makes to *available*
 * credits, so the caller can fold several releases into a single wallet update.
 *
 * A hold can outlive its lot — a reservation taken shortly before a lot's
 * `expiresAt` is only swept up to `RESERVATION_TTL_HOURS` later — so the returned
 * credit can land in a lot that is dead or dying. Two disjoint mechanisms cover
 * that, split on whether the lot is still open, because each is unsound in the
 * other's case:
 *
 *  - **Lot still `active`** (whether or not it is past `expiresAt`): return `+1`
 *    honestly and let the caller's trailing `expireDueLotsInTx` write off whatever
 *    is left. Compensating here instead would be wrong — the `creditsReserved`
 *    decrement puts the credit straight back into `availableInLot`, so the next
 *    sweep would write the same credit off a second time and drive the wallet
 *    negative.
 *  - **Lot no longer `active`** (`expired` by an earlier sweep, or `frozen` /
 *    `revoked`): the trailing sweep matches only `status: "active"`, so it will
 *    never touch this lot again. Returning `+1` would mint a credit no lot backs.
 *    The `release` (+1) is therefore balanced by an `expire` (−1) in the same
 *    transaction and the wallet's available total is left unchanged.
 *
 * The second case is reached on the ordinary path, not just by an external actor:
 * two holds on one due lot: the first release's trailing sweep closes the lot, so
 * the second release finds it already `expired`.
 *
 * Both branches keep the ledger append-only and `Σ delta == wallet.availableCredits`.
 */
async function releaseReservationRow(
  tx: Prisma.TransactionClient,
  reservation: ReservationRow,
  now: Date,
  reason: string,
): Promise<number> {
  const lot = await tx.creditLot.update({
    where: { id: reservation.lotId },
    data: { creditsReserved: { decrement: 1 } },
  });
  await tx.creditReservation.update({
    where: { id: reservation.id },
    data: { status: "released", resolvedAt: now },
  });
  await tx.creditLedgerEntry.create({
    data: {
      organizationId: reservation.organizationId,
      lotId: reservation.lotId,
      type: "release",
      delta: 1,
      candidateSessionId: reservation.candidateSessionId,
      actorKind: "system",
      reason,
    },
  });

  if (lot.status === "active") {
    return 1;
  }

  await tx.creditLedgerEntry.create({
    data: {
      organizationId: reservation.organizationId,
      lotId: reservation.lotId,
      type: "expire",
      delta: -1,
      candidateSessionId: reservation.candidateSessionId,
      actorKind: "system",
      reason: "released_into_closed_lot",
    },
  });
  return 0;
}

async function expireDueLotsInTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  now: Date,
): Promise<{ expiredLotIds: string[] }> {
  const rows = await tx.creditLot.findMany({
    where: { organizationId, status: "active", expiresAt: { lte: now } },
  });
  if (rows.length === 0) {
    return { expiredLotIds: [] };
  }

  const expiredLotIds: string[] = [];
  let writtenOff = 0;
  for (const row of rows) {
    const remaining = availableInLot(toLotSnapshot(row));
    await tx.creditLot.update({ where: { id: row.id }, data: { status: "expired" } });
    await tx.creditLedgerEntry.create({
      data: {
        organizationId,
        lotId: row.id,
        type: "expire",
        delta: -remaining,
        actorKind: "system",
        reason: "lot_expired",
      },
    });
    expiredLotIds.push(row.id);
    writtenOff += remaining;
  }
  if (writtenOff > 0) {
    await tx.creditWallet.update({
      where: { organizationId },
      data: { availableCredits: { decrement: writtenOff } },
    });
  }

  return { expiredLotIds };
}
