# Prepaid Credit Ledger (Phase 1 of #140) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The credit ledger, reservation lifecycle and wallet lock from issue #140 — fully working and tested with **no Stripe dependency**, behind a default-off flag.

**Architecture:** Four new Prisma models (wallet, lot, ledger, reservation) with the append-only ledger as source of truth and the wallet row as a per-organization `FOR UPDATE` lock target. Pure decision logic (lot ordering, billable threshold) lives in `@prelude/core`; the transactional service lives in `@prelude/billing`; `apps/candidate` swaps its admission path to reserve → capture → release when `CREDIT_BILLING_ENABLED=true`.

**Tech Stack:** Prisma/Postgres, Vitest 4, pnpm + Turborepo. No new dependencies.

## Global Constraints

- **No `stripe` package anywhere in this phase.** Purchases arrive in Phase 2.
- **`CREDIT_BILLING_ENABLED` defaults off.** With the flag off, behaviour is byte-for-byte today's Clerk-projection path. Follow the `isEnabled()` pattern from `packages/billing/src/server.ts`.
- **The ledger is append-only.** No code path ever issues UPDATE or DELETE on `CreditLedgerEntry`.
- **Consumption sort key (from #139, verbatim):** free lots first, then `expiresAt` ascending, then `grantedAt` ascending, then `id` ascending.
- **Ledger `delta` is the signed change to *available* credits** (`granted − consumed − reserved`): `free_grant +N`, `pack_purchase +N`, `reserve −1`, `release +1`, `consume 0` (reserved→consumed), `expire −remaining`, `manual_adjustment ±N`. Reconciliation depends on this definition.
- **Credit tables reference `Organization.id`** (internal cuid), never the Clerk org id, with `onDelete: Restrict` — billing evidence must block deletion, never cascade away (same fail-closed principle as issue #100). **No FK to `CandidateSession`**: audit records must survive product-row deletion.
- Constants: `FIRST_FIVE_CREDITS = 5`, `FIRST_FIVE_EXPIRY_DAYS = 30`, `RESERVATION_TTL_HOURS = 12`, `BILLABLE_THRESHOLD_RATIO = 0.5`. Money is integer cents, EUR.
- New schema follows product-side house style (camelCase columns, `@default(cuid())`, no `@@map`) — like `CandidateSession`, not like the Go-owned `live_interview_*` tables.
- Commands: `MIGRATION_NAME=<name> make db-migrate`, `make db-generate`, `pnpm --filter <pkg> exec vitest run <file>`, `pnpm typecheck`, `pnpm lint`.
- Postgres-backed tests are gated: they skip unless `TEST_DATABASE_URL` is set (pattern mirrors the repo's `ALLOW_LIVE_LLM_TESTS` gating). CI never needs a database for `pnpm test`.
- Every event payload key read from `LiveInterviewEvent.payload` is snake_case (`completion_reason`) — Go writes them.

---

### Task 1: Schema — wallet, lot, ledger, reservation

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after `OrganizationBillingState`, line ~376; add relations on `Organization`)

**Interfaces:**
- Produces: Prisma models `CreditWallet`, `CreditLot`, `CreditLedgerEntry`, `CreditReservation` and their generated client types, used by Tasks 4–7.

- [ ] **Step 1: Add the four models to `schema.prisma`**

```prisma
// Credit billing (issue #140, phase 1). The ledger is append-only and is the
// source of truth; the wallet row caches totals and is the FOR UPDATE lock
// target that serialises credit operations per organization. Rows here must
// survive product-row deletion, so nothing cascades from CandidateSession and
// organizations with billing history cannot be hard-deleted (Restrict).
model CreditWallet {
  id               String       @id @default(cuid())
  organizationId   String       @unique
  availableCredits Int          @default(0)
  reservedCredits  Int          @default(0)
  stripeCustomerId String?      @unique
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  organization     Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
}

model CreditLot {
  id                      String       @id @default(cuid())
  organizationId          String
  kind                    String // free | paid
  source                  String // first_five | pack_purchase | auto_topup | manual_grant | enterprise_commitment
  packId                  String?
  creditsGranted          Int
  creditsConsumed         Int          @default(0)
  creditsReserved         Int          @default(0)
  unitAmountCents         Int?
  currency                String       @default("EUR")
  status                  String       @default("active") // active | exhausted | expired | frozen | revoked
  grantedAt               DateTime
  expiresAt               DateTime
  stripePaymentIntentId   String?      @unique
  stripeCheckoutSessionId String?      @unique
  stripeInvoiceId         String?      @unique
  createdAt               DateTime     @default(now())
  updatedAt               DateTime     @updatedAt
  organization            Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  ledgerEntries           CreditLedgerEntry[]
  reservations            CreditReservation[]

  @@index([organizationId, status, expiresAt])
}

model CreditLedgerEntry {
  id                 String       @id @default(cuid())
  organizationId     String
  lotId              String?
  type               String // free_grant | pack_purchase | reserve | release | consume | refund_reversal | expire | manual_adjustment | dispute_freeze | dispute_release
  delta              Int // signed change to available credits (see plan header)
  candidateSessionId String?
  stripeEventId      String?
  actorKind          String       @default("system") // system | stripe_webhook | admin
  actorId            String?
  reason             String?
  createdAt          DateTime     @default(now())
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  lot                CreditLot?   @relation(fields: [lotId], references: [id], onDelete: Restrict)

  @@index([organizationId, createdAt])
}

model CreditReservation {
  id                 String       @id @default(cuid())
  organizationId     String
  candidateSessionId String       @unique
  lotId              String
  status             String       @default("held") // held | captured | released
  heldAt             DateTime
  expiresAt          DateTime
  resolvedAt         DateTime?
  organization       Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  lot                CreditLot    @relation(fields: [lotId], references: [id], onDelete: Restrict)

  @@index([organizationId, status, expiresAt])
}
```

And on `model Organization`, add to the relation list:

```prisma
  creditWallet           CreditWallet?
  creditLots             CreditLot[]
  creditLedgerEntries    CreditLedgerEntry[]
  creditReservations     CreditReservation[]
```

- [ ] **Step 2: Create the migration and regenerate the client**

Run: `MIGRATION_NAME=add_credit_ledger make db-migrate && make db-generate`
Expected: migration applies cleanly; generated client exposes `prisma.creditWallet`, `prisma.creditLot`, `prisma.creditLedgerEntry`, `prisma.creditReservation`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @prelude/db exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma
git commit -m "feat(db): credit wallet, lot, ledger and reservation models"
```

---

### Task 2: Pure lot policy in `@prelude/core`

**Files:**
- Create: `packages/core/src/domain/credit-lots.ts`
- Create: `packages/core/src/domain/credit-lots.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)

**Interfaces:**
- Produces (used by Tasks 4–5 and the wallet UI later):

```ts
export type CreditLotSnapshot = {
  id: string;
  kind: "free" | "paid";
  status: "active" | "exhausted" | "expired" | "frozen" | "revoked";
  creditsGranted: number;
  creditsConsumed: number;
  creditsReserved: number;
  grantedAt: Date;
  expiresAt: Date;
};
export function availableInLot(lot: CreditLotSnapshot): number;
export function isLotEligible(lot: CreditLotSnapshot, now: Date): boolean;
export function compareLotsForConsumption(a: CreditLotSnapshot, b: CreditLotSnapshot): number;
export function selectLotForReservation(lots: CreditLotSnapshot[], now: Date): CreditLotSnapshot | null;
export function computeWalletTotals(lots: CreditLotSnapshot[], now: Date): {
  available: number; reserved: number; freeAvailable: number; paidAvailable: number;
  nextExpiry: { credits: number; expiresAt: Date } | null;
};
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import {
  availableInLot,
  compareLotsForConsumption,
  computeWalletTotals,
  isLotEligible,
  selectLotForReservation,
  type CreditLotSnapshot,
} from "./credit-lots";

const now = new Date("2026-08-14T12:00:00.000Z");

function lot(overrides: Partial<CreditLotSnapshot>): CreditLotSnapshot {
  return {
    id: "lot_1",
    kind: "paid",
    status: "active",
    creditsGranted: 100,
    creditsConsumed: 0,
    creditsReserved: 0,
    grantedAt: new Date("2026-01-10T00:00:00.000Z"),
    expiresAt: new Date("2027-01-10T00:00:00.000Z"),
    ...overrides,
  };
}

describe("credit lot policy", () => {
  it("counts reserved credits as unavailable", () => {
    expect(availableInLot(lot({ creditsConsumed: 40, creditsReserved: 2 }))).toBe(58);
  });

  it("rejects expired, frozen and exhausted lots even when status lags", () => {
    expect(isLotEligible(lot({ expiresAt: new Date("2026-08-14T11:59:59Z") }), now)).toBe(false);
    expect(isLotEligible(lot({ status: "frozen" }), now)).toBe(false);
    expect(isLotEligible(lot({ creditsConsumed: 100 }), now)).toBe(false);
    expect(isLotEligible(lot({}), now)).toBe(true);
  });

  it("orders free before paid, then soonest expiry, then oldest grant, then id", () => {
    const paidLater = lot({ id: "b", expiresAt: new Date("2027-06-01T00:00:00Z") });
    const paidSooner = lot({ id: "c", expiresAt: new Date("2026-12-01T00:00:00Z") });
    const free = lot({ id: "a", kind: "free", expiresAt: new Date("2027-06-01T00:00:00Z") });
    const sorted = [paidLater, paidSooner, free].sort(compareLotsForConsumption);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "c", "b"]);
  });

  it("selects the first eligible lot and returns null when none qualifies", () => {
    const expired = lot({ id: "x", kind: "free", expiresAt: new Date("2026-08-01T00:00:00Z") });
    const paid = lot({ id: "y" });
    expect(selectLotForReservation([expired, paid], now)?.id).toBe("y");
    expect(selectLotForReservation([expired], now)).toBeNull();
  });

  it("computes totals from eligible lots only and reports the soonest expiry", () => {
    const totals = computeWalletTotals(
      [
        lot({ id: "free", kind: "free", creditsGranted: 5, creditsConsumed: 3 }),
        lot({ id: "paid", creditsReserved: 1, expiresAt: new Date("2026-10-01T00:00:00Z") }),
        lot({ id: "dead", expiresAt: new Date("2026-08-01T00:00:00Z") }),
      ],
      now,
    );
    expect(totals).toEqual({
      available: 101,
      reserved: 1,
      freeAvailable: 2,
      paidAvailable: 99,
      nextExpiry: { credits: 99, expiresAt: new Date("2026-10-01T00:00:00Z") },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @prelude/core exec vitest run src/domain/credit-lots.test.ts`
Expected: FAIL — module `./credit-lots` not found.

- [ ] **Step 3: Implement**

```ts
export type CreditLotSnapshot = {
  id: string;
  kind: "free" | "paid";
  status: "active" | "exhausted" | "expired" | "frozen" | "revoked";
  creditsGranted: number;
  creditsConsumed: number;
  creditsReserved: number;
  grantedAt: Date;
  expiresAt: Date;
};

export function availableInLot(lot: CreditLotSnapshot): number {
  return lot.creditsGranted - lot.creditsConsumed - lot.creditsReserved;
}

// Expiry is checked against the clock, not the status column, so balances stay
// correct even when the expiry sweep has not run yet.
export function isLotEligible(lot: CreditLotSnapshot, now: Date): boolean {
  return lot.status === "active" && lot.expiresAt > now && availableInLot(lot) > 0;
}

// The single consumption sort key from #139: free first, then soonest expiry,
// then oldest grant, then id as a deterministic tiebreak.
export function compareLotsForConsumption(a: CreditLotSnapshot, b: CreditLotSnapshot): number {
  if (a.kind !== b.kind) return a.kind === "free" ? -1 : 1;
  if (a.expiresAt.getTime() !== b.expiresAt.getTime()) {
    return a.expiresAt.getTime() - b.expiresAt.getTime();
  }
  if (a.grantedAt.getTime() !== b.grantedAt.getTime()) {
    return a.grantedAt.getTime() - b.grantedAt.getTime();
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectLotForReservation(
  lots: CreditLotSnapshot[],
  now: Date,
): CreditLotSnapshot | null {
  const eligible = lots.filter((lot) => isLotEligible(lot, now));
  eligible.sort(compareLotsForConsumption);
  return eligible[0] ?? null;
}

export function computeWalletTotals(lots: CreditLotSnapshot[], now: Date) {
  const eligible = lots.filter((lot) => isLotEligible(lot, now));
  const available = eligible.reduce((sum, lot) => sum + availableInLot(lot), 0);
  const reserved = eligible.reduce((sum, lot) => sum + lot.creditsReserved, 0);
  const freeAvailable = eligible
    .filter((lot) => lot.kind === "free")
    .reduce((sum, lot) => sum + availableInLot(lot), 0);
  const soonest = [...eligible].sort(
    (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime(),
  )[0];
  return {
    available,
    reserved,
    freeAvailable,
    paidAvailable: available - freeAvailable,
    nextExpiry: soonest
      ? { credits: availableInLot(soonest), expiresAt: soonest.expiresAt }
      : null,
  };
}
```

- [ ] **Step 4: Run to verify pass, re-export, commit**

Run: `pnpm --filter @prelude/core exec vitest run src/domain/credit-lots.test.ts` → PASS.
Add to `packages/core/src/index.ts` alongside the existing domain exports:

```ts
export {
  availableInLot,
  compareLotsForConsumption,
  computeWalletTotals,
  isLotEligible,
  selectLotForReservation,
  type CreditLotSnapshot,
} from "./domain/credit-lots";
```

```bash
git add packages/core/src
git commit -m "feat(core): credit lot consumption policy"
```

---

### Task 3: Billable completion threshold in `@prelude/core`

**Files:**
- Create: `packages/core/src/domain/billable-completion.ts`
- Create: `packages/core/src/domain/billable-completion.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (used by Task 7):

```ts
export const BILLABLE_THRESHOLD_RATIO = 0.5;
export type QuestionOutcome = { completionReason: string };
export function evaluateBillableCompletion(input: {
  plannedQuestionCount: number;
  outcomes: QuestionOutcome[];
  thresholdRatio?: number;
}): { billable: boolean; answeredCount: number; requiredCount: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import { evaluateBillableCompletion } from "./billable-completion";

const answered = { completionReason: "answered" };
const skipped = { completionReason: "skipped" };

describe("evaluateBillableCompletion", () => {
  it("bills when at least half the planned questions were answered", () => {
    expect(
      evaluateBillableCompletion({
        plannedQuestionCount: 4,
        outcomes: [answered, answered, skipped, skipped],
      }),
    ).toEqual({ billable: true, answeredCount: 2, requiredCount: 2 });
  });

  it("rounds the threshold up on odd plans", () => {
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 5,
      outcomes: [answered, answered, skipped],
    });
    expect(result).toEqual({ billable: false, answeredCount: 2, requiredCount: 3 });
  });

  it("counts only answered outcomes, never skips or silence", () => {
    const result = evaluateBillableCompletion({
      plannedQuestionCount: 2,
      outcomes: [skipped, { completionReason: "candidate_silent" }, { completionReason: "timeboxed" }],
    });
    expect(result.billable).toBe(false);
  });

  it("never bills an empty or zero-question plan", () => {
    expect(evaluateBillableCompletion({ plannedQuestionCount: 0, outcomes: [] })).toEqual({
      billable: false,
      answeredCount: 0,
      requiredCount: 0,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @prelude/core exec vitest run src/domain/billable-completion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// The billing event from #139: an interview is billable when at least half the
// planned questions were actually answered, judged from the append-only live
// event store. Pure so the rule can be replayed over historical sessions to
// validate the ratio before launch.
export const BILLABLE_THRESHOLD_RATIO = 0.5;

export type QuestionOutcome = { completionReason: string };

export function evaluateBillableCompletion(input: {
  plannedQuestionCount: number;
  outcomes: QuestionOutcome[];
  thresholdRatio?: number;
}): { billable: boolean; answeredCount: number; requiredCount: number } {
  const ratio = input.thresholdRatio ?? BILLABLE_THRESHOLD_RATIO;
  if (input.plannedQuestionCount <= 0) {
    return { billable: false, answeredCount: 0, requiredCount: 0 };
  }
  const answeredCount = input.outcomes.filter(
    (outcome) => outcome.completionReason === "answered",
  ).length;
  const requiredCount = Math.max(1, Math.ceil(input.plannedQuestionCount * ratio));
  return { billable: answeredCount >= requiredCount, answeredCount, requiredCount };
}
```

- [ ] **Step 4: Run to verify pass, re-export, commit**

Run: `pnpm --filter @prelude/core exec vitest run src/domain/billable-completion.test.ts` → PASS.
Re-export from `packages/core/src/index.ts`, then:

```bash
git add packages/core/src
git commit -m "feat(core): billable completion threshold"
```

---

### Task 4: Ledger service in `@prelude/billing` + Postgres test harness

**Files:**
- Create: `packages/billing/src/credit-ledger.ts`
- Create: `packages/billing/src/credit-ledger.db.test.ts`
- Modify: `packages/billing/src/index.ts`
- Modify: `packages/billing/package.json` (add `"@prelude/core": "workspace:*"` and `"@prelude/db": "workspace:*"` to dependencies if absent)

**Interfaces:**
- Consumes: Task 1 models, Task 2 policy functions.
- Produces (used by Tasks 5–7):

```ts
export const FIRST_FIVE_CREDITS = 5;
export const FIRST_FIVE_EXPIRY_DAYS = 30;
export const RESERVATION_TTL_HOURS = 12;

export function ensureWallet(db: PrismaClient, input: { organizationId: string; now: Date }): Promise<{ walletId: string }>;
export function reserveCreditForSession(db: PrismaClient, input: { organizationId: string; candidateSessionId: string; now: Date }): Promise<{ ok: true; reservationId: string } | { ok: false; error: "no_credits_available" }>;
export function captureReservationForSession(db: PrismaClient, input: { organizationId: string; candidateSessionId: string; now: Date }): Promise<{ outcome: "captured" | "already_captured" | "no_reservation" }>;
export function releaseReservationForSession(db: PrismaClient, input: { organizationId: string; candidateSessionId: string; now: Date; reason: string }): Promise<{ outcome: "released" | "already_resolved" | "no_reservation" }>;
export function releaseExpiredReservations(db: PrismaClient, input: { organizationId: string; now: Date }): Promise<{ releasedCount: number }>;
export function expireDueLots(db: PrismaClient, input: { organizationId: string; now: Date }): Promise<{ expiredLotIds: string[] }>;
export function reconcileWallet(db: PrismaClient, input: { organizationId: string }): Promise<{ consistent: boolean; expected: { available: number; reserved: number }; actual: { available: number; reserved: number } }>;
```

**Design, fixed here so every implementer writes the same thing:**
- Every mutating function runs one `db.$transaction(async (tx) => …)` whose **first statement** is `await tx.$queryRaw\`SELECT "id" FROM "CreditWallet" WHERE "organizationId" = ${organizationId} FOR UPDATE\``. That row lock serialises credit operations per organization — replacing the global `Serializable` + `P2034` retry loop — and brings the balance read inside the transaction (closing the flaw where entitlement is read outside it, `billing-admission.ts:31-35`).
- `ensureWallet` creates the wallet **and** the `first_five` lot (+ `free_grant` ledger entry, `expiresAt = now + 30 days`) in the same transaction. **Deliberate deviation from #140's "grant on organization creation":** the grant happens lazily on first billing touch instead. Organizations are created at four different call sites (`organization-onboarding.ts:425,453,662`, `organization-scope.ts:189`); hooking all four is fragile, a customer cannot observe a wallet before touching billing, and the 30-day free-credit clock starting at first use is strictly friendlier. Existing pre-launch organizations get their grant the same way. The `organizationId @unique` on the wallet makes the grant race-safe with no partial index: the lot is only ever written together with the wallet row, and on a unique-violation race the loser re-reads and returns the existing wallet.
- `reserveCreditForSession`: after the lock — return the existing reservation if one exists for this `candidateSessionId` (resume-safe); opportunistically run the per-org expiry and TTL sweeps (cheap under the lock); load active lots, pick via `selectLotForReservation`; none → `no_credits_available`; otherwise increment `creditsReserved`, insert the reservation (`expiresAt = now + RESERVATION_TTL_HOURS`), write a `reserve` (−1) entry, update wallet totals.
- `captureReservationForSession`: reservation `held` → `captured`, lot `creditsReserved −1` / `creditsConsumed +1`, mark lot `exhausted` when fully consumed, `consume` (0) entry linked to the session. Missing reservation → `no_reservation` (sessions created while the flag was off) — log, never throw.
- `releaseReservationForSession` / `releaseExpiredReservations`: `held` → `released`, `creditsReserved −1`, `release` (+1) entry.
- `expireDueLots`: active lots with `expiresAt <= now` → status `expired`, one `expire` entry with `delta = −availableInLot`, decrement wallet.
- `reconcileWallet`: recompute expected totals from lots (via `computeWalletTotals`) and compare with the wallet row; also verify `Σ ledger.delta = wallet.availableCredits`.

- [ ] **Step 1: Write the failing db-gated test**

```ts
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureReservationForSession,
  ensureWallet,
  expireDueLots,
  reconcileWallet,
  releaseReservationForSession,
  reserveCreditForSession,
} from "./credit-ledger";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("credit ledger (Postgres)", () => {
  let db: PrismaClient;
  let organizationId: string;
  const now = new Date("2026-08-14T12:00:00.000Z");

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
      candidateSessionId: "cs_1",
      now,
    });
    expect(reserved.ok).toBe(true);

    const captured = await captureReservationForSession(db, {
      organizationId,
      candidateSessionId: "cs_1",
      now,
    });
    expect(captured.outcome).toBe("captured");

    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId } });
    expect(wallet).toMatchObject({ availableCredits: 4, reservedCredits: 0 });

    const audit = await reconcileWallet(db, { organizationId });
    expect(audit.consistent).toBe(true);
  });

  it("releases instead of consuming when the interview is not billable", async () => {
    await reserveCreditForSession(db, { organizationId, candidateSessionId: "cs_2", now });
    const released = await releaseReservationForSession(db, {
      organizationId,
      candidateSessionId: "cs_2",
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
});
```

- [ ] **Step 2: Prepare the test database and verify the test fails**

```bash
make env-up
psql postgresql://postgres:postgres@localhost:5440/postgres -c 'CREATE DATABASE prelude_credit_test' || true
DATABASE_URL=postgresql://postgres:postgres@localhost:5440/prelude_credit_test \
  pnpm --filter @prelude/db exec prisma db push --skip-generate
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/prelude_credit_test \
  pnpm --filter @prelude/billing exec vitest run src/credit-ledger.db.test.ts
```

Expected: FAIL — `./credit-ledger` not found. Also run once **without** `TEST_DATABASE_URL` and confirm the suite reports skipped, not failed.

- [ ] **Step 3: Implement `credit-ledger.ts` per the design block above**

The skeleton every function follows (shown once; all six mutators use it):

```ts
import type { PrismaClient, Prisma } from "@prelude/db";
import { selectLotForReservation, computeWalletTotals, availableInLot } from "@prelude/core";

export const FIRST_FIVE_CREDITS = 5;
export const FIRST_FIVE_EXPIRY_DAYS = 30;
export const RESERVATION_TTL_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

async function lockWallet(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "CreditWallet" WHERE "organizationId" = ${organizationId} FOR UPDATE`;
}

export async function reserveCreditForSession(
  db: PrismaClient,
  input: { organizationId: string; candidateSessionId: string; now: Date },
) {
  await ensureWallet(db, input);
  return db.$transaction(async (tx) => {
    await lockWallet(tx, input.organizationId);
    const existing = await tx.creditReservation.findUnique({
      where: { candidateSessionId: input.candidateSessionId },
    });
    if (existing && existing.status === "held") {
      return { ok: true as const, reservationId: existing.id };
    }
    // …sweeps, lot selection via selectLotForReservation, counters, ledger
    // entry { type: "reserve", delta: -1 }, wallet update — per the design block.
  });
}
```

Implement all seven exported functions. Money/counter updates and their ledger entry always happen in the same transaction — never split.

- [ ] **Step 4: Run to verify pass**

Run the Step 2 gated command again. Expected: 3 passed.

- [ ] **Step 5: Re-export and commit**

Add the seven functions and three constants to `packages/billing/src/index.ts`, then:

```bash
git add packages/billing/src packages/billing/package.json
git commit -m "feat(billing): prepaid credit ledger with per-organization wallet lock"
```

---

### Task 5: Concurrency and idempotence proof (Postgres)

**Files:**
- Modify: `packages/billing/src/credit-ledger.db.test.ts` (new describe block)

**Interfaces:**
- Consumes: Task 4 functions, unchanged. This task adds only tests — it exists so a reviewer can reject the concurrency claim independently of the happy path.

- [ ] **Step 1: Write the failing/green-proving tests**

```ts
describe.skipIf(!databaseUrl)("credit ledger under concurrency", () => {
  it("never over-reserves: 10 parallel admissions against 3 credits hold exactly 3", async () => {
    const organization = await db.organization.create({ data: { name: `conc-${Date.now()}` } });
    await ensureWallet(db, { organizationId: organization.id, now });
    await db.$transaction([
      db.creditLot.updateMany({
        where: { organizationId: organization.id },
        data: { creditsGranted: 3 },
      }),
      db.creditWallet.update({
        where: { organizationId: organization.id },
        data: { availableCredits: 3 },
      }),
    ]);

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        reserveCreditForSession(db, {
          organizationId: organization.id,
          candidateSessionId: `conc_cs_${index}`,
          now,
        }),
      ),
    );
    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(3);

    const wallet = await db.creditWallet.findUniqueOrThrow({
      where: { organizationId: organization.id },
    });
    expect(wallet).toMatchObject({ availableCredits: 0, reservedCredits: 3 });
    expect((await reconcileWallet(db, { organizationId: organization.id })).consistent).toBe(true);
  });

  it("is resume-safe: reserving twice for one session yields one reservation", async () => {
    const organization = await db.organization.create({ data: { name: `resume-${Date.now()}` } });
    await ensureWallet(db, { organizationId: organization.id, now });
    const [first, second] = [
      await reserveCreditForSession(db, { organizationId: organization.id, candidateSessionId: "resume_cs", now }),
      await reserveCreditForSession(db, { organizationId: organization.id, candidateSessionId: "resume_cs", now }),
    ];
    expect(first).toEqual(second);
    const wallet = await db.creditWallet.findUniqueOrThrow({
      where: { organizationId: organization.id },
    });
    expect(wallet.reservedCredits).toBe(1);
  });

  it("captures at most once, even when completion is delivered twice", async () => {
    const organization = await db.organization.create({ data: { name: `cap-${Date.now()}` } });
    await ensureWallet(db, { organizationId: organization.id, now });
    await reserveCreditForSession(db, { organizationId: organization.id, candidateSessionId: "cap_cs", now });
    const first = await captureReservationForSession(db, { organizationId: organization.id, candidateSessionId: "cap_cs", now });
    const second = await captureReservationForSession(db, { organizationId: organization.id, candidateSessionId: "cap_cs", now });
    expect(first.outcome).toBe("captured");
    expect(second.outcome).toBe("already_captured");
    const lot = await db.creditLot.findFirstOrThrow({ where: { organizationId: organization.id } });
    expect(lot.creditsConsumed).toBe(1);
  });

  it("races on ensureWallet still grant First Five once", async () => {
    const organization = await db.organization.create({ data: { name: `race-${Date.now()}` } });
    await Promise.all(
      Array.from({ length: 5 }, () => ensureWallet(db, { organizationId: organization.id, now })),
    );
    expect(await db.creditLot.count({ where: { organizationId: organization.id } })).toBe(1);
    expect(await db.creditWallet.count({ where: { organizationId: organization.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run against Postgres**

Run the gated command from Task 4 Step 2. Expected: all pass. If over-reservation appears, the bug is in Task 4's lock ordering — fix there, not by loosening the test.

- [ ] **Step 3: Commit**

```bash
git add packages/billing/src/credit-ledger.db.test.ts
git commit -m "test(billing): prove the wallet lock under concurrent admissions"
```

---

### Task 6: `CREDIT_BILLING_ENABLED` flag and the admission swap

**Files:**
- Create: `packages/billing/src/credit-billing-flag.ts` (+ inline tests in `credit-billing-flag.test.ts`)
- Modify: `apps/candidate/src/server/billing-admission.ts`
- Modify: `apps/candidate/src/server/billing-admission.test.ts`

**Interfaces:**
- Consumes: `reserveCreditForSession` (Task 4 signature).
- Produces: `isCreditBillingEnabled(): boolean` from `@prelude/billing`; `createEntitledCandidateSession` keeps its **exact existing signature and result union** — callers must not change. New error variant: `"no_credits_available"` maps onto the existing `"candidate_interview_limit_reached"` result code so route handlers stay untouched.

- [ ] **Step 1: Flag helper + test**

```ts
// credit-billing-flag.ts — same convention as isEnabled() in server.ts.
export function isCreditBillingEnabled(): boolean {
  const raw = process.env.CREDIT_BILLING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
```

Test: unset → false, `"1"`/`"true"`/`"TRUE "` → true, `"0"`/`"false"` → false (use `vi.stubEnv`). Run, verify, no commit yet.

- [ ] **Step 2: Write the failing admission tests**

Extend `billing-admission.test.ts`, following the house `fakeDatabase()` pattern already in the file:

```ts
it("reserves a credit instead of counting usage when credit billing is enabled", async () => {
  vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
  const reserve = vi.fn().mockResolvedValue({ ok: true, reservationId: "res_1" });
  const database = fakeDatabase(0);
  const result = await createEntitledCandidateSession(
    sessionInput(),
    { ...dependencies(database, paidBilling()), reserveCredit: reserve },
  );
  expect(result.ok).toBe(true);
  expect(reserve).toHaveBeenCalledWith(expect.anything(), {
    organizationId: "org_1",
    candidateSessionId: expect.any(String),
    now,
  });
  expect(database.candidateSession.count).not.toHaveBeenCalled();
});

it("refuses admission with the existing limit code when the wallet is empty", async () => {
  vi.stubEnv("CREDIT_BILLING_ENABLED", "1");
  const reserve = vi.fn().mockResolvedValue({ ok: false, error: "no_credits_available" });
  const result = await createEntitledCandidateSession(
    sessionInput(),
    { ...dependencies(fakeDatabase(0), paidBilling()), reserveCredit: reserve },
  );
  expect(result).toMatchObject({ ok: false, error: "candidate_interview_limit_reached" });
});

it("keeps the legacy count-based path byte-for-byte when the flag is off", async () => {
  vi.stubEnv("CREDIT_BILLING_ENABLED", "");
  const reserve = vi.fn();
  await createEntitledCandidateSession(
    sessionInput(),
    { ...dependencies(fakeDatabase(0), paidBilling()), reserveCredit: reserve },
  );
  expect(reserve).not.toHaveBeenCalled();
});
```

Run: `pnpm --filter @prelude/candidate exec vitest run src/server/billing-admission.test.ts` → FAIL (unknown dependency `reserveCredit`).

- [ ] **Step 3: Implement the swap**

In `billing-admission.ts`: add `reserveCredit: typeof reserveCreditForSession` to `BillingAdmissionDependencies` (default: the real function). When `isCreditBillingEnabled()`: create the session first with `prisma.candidateSession.create` inside the transaction, then call `reserveCredit` with the created session id; on `no_credits_available`, roll back by throwing inside the transaction and return the mapped error. Recording entitlement: keep the existing `evaluateWorkspaceEntitlement({ feature: "recording" … })` call unchanged in both branches. When the flag is off: existing code, untouched.

- [ ] **Step 4: Run all candidate tests, then commit**

Run: `pnpm --filter @prelude/candidate test` → all pass (legacy tests prove the off-branch).

```bash
git add packages/billing/src apps/candidate/src/server
git commit -m "feat(candidate): reserve prepaid credits at admission behind CREDIT_BILLING_ENABLED"
```

---

### Task 7: Capture on completion, release on failure

**Files:**
- Modify: `apps/candidate/src/server/public-interviews.ts` (`completeCandidateSession` at :434, `markCandidateSessionLifecycle` at :502, `submitCandidateFormInterview` at :568)
- Create: `apps/candidate/src/server/credit-settlement.ts` + `credit-settlement.test.ts`

**Interfaces:**
- Consumes: `captureReservationForSession`, `releaseReservationForSession` (Task 4), `evaluateBillableCompletion` (Task 3).
- Produces: `settleCandidateSessionCredit(db, { sessionId, now, kind: "completed" | "abandoned" | "failed" }): Promise<void>` — the single settlement entry point all three call sites use. Never throws: settlement failure is logged, the candidate-facing response is never blocked by billing.

- [ ] **Step 1: Write the failing settlement tests**

`credit-settlement.test.ts`, with a house-style fake db:

```ts
it("captures when the session met the billable threshold", async () => {
  // fake session: realtimeSessionId "is_1", interview with 4 questions;
  // fake events: 2 question_completed with payload {completion_reason:"answered"},
  //              2 with {completion_reason:"skipped"}
  await settleCandidateSessionCredit(db, { sessionId: "cs_1", now, kind: "completed" });
  expect(capture).toHaveBeenCalledWith(db, {
    organizationId: "org_1", candidateSessionId: "cs_1", now,
  });
});

it("releases a completed session that stayed below the threshold", async () => {
  // 1 answered out of 4 planned
  await settleCandidateSessionCredit(db, { sessionId: "cs_1", now, kind: "completed" });
  expect(release).toHaveBeenCalledWith(db, expect.objectContaining({
    reason: "below_billable_threshold",
  }));
});

it("releases on abandon and on failure without reading events", async () => {
  await settleCandidateSessionCredit(db, { sessionId: "cs_1", now, kind: "failed" });
  expect(release).toHaveBeenCalledWith(db, expect.objectContaining({ reason: "failed" }));
});

it("swallows settlement errors so the candidate flow never breaks", async () => {
  capture.mockRejectedValueOnce(new Error("db down"));
  await expect(
    settleCandidateSessionCredit(db, { sessionId: "cs_1", now, kind: "completed" }),
  ).resolves.toBeUndefined();
});
```

Run to verify FAIL (module not found).

- [ ] **Step 2: Implement `credit-settlement.ts`**

```ts
// Settlement of the credit reserved at admission. "completed" consults the
// live event store; everything else releases. Sessions admitted while the
// flag was off have no reservation — capture/release both report
// no_reservation and this stays a no-op.
export async function settleCandidateSessionCredit(
  db: PrismaClient,
  input: { sessionId: string; now: Date; kind: "completed" | "abandoned" | "failed" },
): Promise<void> {
  if (!isCreditBillingEnabled()) return;
  try {
    const session = await db.candidateSession.findUnique({
      select: {
        organizationId: true,
        realtimeSessionId: true,
        interview: { select: { questions: true } },
      },
      where: { id: input.sessionId },
    });
    if (!session) return;

    if (input.kind !== "completed") {
      await releaseReservationForSession(db, {
        organizationId: session.organizationId,
        candidateSessionId: input.sessionId,
        now: input.now,
        reason: input.kind,
      });
      return;
    }

    const plannedQuestionCount = Array.isArray(session.interview.questions)
      ? session.interview.questions.length
      : 0;
    const outcomes = session.realtimeSessionId
      ? (
          await db.liveInterviewEvent.findMany({
            select: { payload: true },
            where: { sessionId: session.realtimeSessionId, type: "question_completed" },
          })
        ).map((event) => ({
          completionReason: String(
            (event.payload as Record<string, unknown>).completion_reason ?? "",
          ),
        }))
      : // Written fallback: submission is validated complete before this runs.
        Array.from({ length: plannedQuestionCount }, () => ({ completionReason: "answered" }));

    const decision = evaluateBillableCompletion({ plannedQuestionCount, outcomes });
    if (decision.billable) {
      await captureReservationForSession(db, {
        organizationId: session.organizationId,
        candidateSessionId: input.sessionId,
        now: input.now,
      });
    } else {
      await releaseReservationForSession(db, {
        organizationId: session.organizationId,
        candidateSessionId: input.sessionId,
        now: input.now,
        reason: "below_billable_threshold",
      });
    }
  } catch (error) {
    console.error("credit settlement failed", { sessionId: input.sessionId, error });
  }
}
```

- [ ] **Step 3: Wire the three call sites**

- `completeCandidateSession` — in the `result.count > 0` branch (public-interviews.ts:457), after `updateCandidateInvitationStatusForSession`, add `await settleCandidateSessionCredit(prisma, { sessionId: input.sessionId, now: new Date(), kind: "completed" });`
- `markCandidateSessionLifecycle` — in its `result.count > 0` branch, add the same call with `kind: input.action === "abandon" ? "abandoned" : "failed"`.
- `submitCandidateFormInterview` — after its successful completion write, `kind: "completed"` (the fallback branch above handles the absent `realtimeSessionId`).

Note the idempotent re-entry branches of both functions (`already completed` paths) also call settlement — `already_captured` makes this safe.

- [ ] **Step 4: Verify preview isolation is structural, then test-pin it**

`prepareCandidateSession` (public-interviews.ts:208-220) refuses every `context.kind !== "published"` before admission — previews can never reserve. Add one test to `credit-settlement.test.ts` documenting that a session with no reservation settles as a no-op (`no_reservation`), which is the preview/legacy behaviour.

- [ ] **Step 5: Full run and commit**

Run: `pnpm --filter @prelude/candidate test && pnpm typecheck` → green.

```bash
git add apps/candidate/src/server
git commit -m "feat(candidate): settle reserved credits on completion, abandon and failure"
```

---

### Task 8: Wire-up, env docs, and full verification

**Files:**
- Modify: `.env.example` (document `CREDIT_BILLING_ENABLED=0` next to the `CLERK_BILLING_*` block)
- Modify: `packages/billing/src/index.ts` (final export audit: everything in the Task 4/6 interface blocks is exported)

**Interfaces:**
- Consumes: everything above. Produces: nothing new — this task is the gate.

- [ ] **Step 1: Document the flag in `.env.example`**

```bash
# Prepaid credit billing (issue #140 phase 1). Off = legacy Clerk projection.
CREDIT_BILLING_ENABLED=0
```

- [ ] **Step 2: Full verification suite**

```bash
pnpm typecheck && pnpm lint && pnpm test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/prelude_credit_test \
  pnpm --filter @prelude/billing exec vitest run src/credit-ledger.db.test.ts
```

Expected: all green, db suite included. Paste real output before claiming success.

- [ ] **Step 3: Manual smoke with the flag on**

`make dev` with `CREDIT_BILLING_ENABLED=1` in `.env.local`; run one candidate interview end to end (`make e2e-smoke` dataset) and check `CreditLedgerEntry` rows: `free_grant +5`, `reserve −1`, then `consume 0` (voice) — via `make db-studio`.

- [ ] **Step 4: Commit and open the PR**

```bash
git add .env.example packages/billing/src/index.ts
git commit -m "chore(billing): document CREDIT_BILLING_ENABLED"
```

PR references #140, states Phase 1 scope, flag default off, and the Phase 2+ dependencies below.

---

## After this plan: Phases 2–4 (separate plans, deliberately not tasked here)

- **Phase 2 — Purchase** (Checkout, webhook, fulfilment, Stripe Tax, catalogue): blocked on the #139 pack-ladder decision and a Stripe test-mode account. The webhook envelope copies `apps/console/app/api/clerk/webhook/route.ts:15-47`; the anti-double-credit constraint (`stripePaymentIntentId @unique`) already exists from Task 1.
- **Phase 3 — Auto Top-Up** (SetupIntent + mandate, off-session charge, `authentication_required` recovery, `AutoTopUpConfig`/`AutoTopUpAttempt` models in their own migration): blocked on Phase 2.
- **Phase 4 — Removal** (billing UI → Interview balance, disable subscription plans, delete Clerk Billing code): blocked on Phases 1–3 shipping and the flag defaulting on.
