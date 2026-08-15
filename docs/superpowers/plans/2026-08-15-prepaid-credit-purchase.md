# Prepaid Credit Purchase (Phase 2 of #140) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A recruiter can buy a credit pack through Stripe Checkout and see the credits land in the Phase 1 ledger — with webhook-driven, idempotent fulfilment, Stripe Tax, minimal refund/dispute handling, and the scheduled billing sweep Phase 1 left unwired.

**Architecture:** Stripe is the payment system; the ledger stays in our Postgres (Phase 1, merged in #146). A `CreditPack` table maps pack slugs to Stripe Prices; a thin console webhook route delegates to a dispatch handler in `@prelude/billing`; fulfilment is one idempotent function called from both the webhook and the browser return, guarded by the `stripePaymentIntentId @unique` constraint from Phase 1. Everything user-visible stays behind `CREDIT_BILLING_ENABLED`.

**Tech Stack:** `stripe` (official Node SDK) in `@prelude/billing`, Prisma/Postgres, Next.js App Router route handlers, Vitest 4. Stripe keys live dotenvx-encrypted in `.env` (already stored: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, test mode).

## Global Constraints

- **Never credit from the browser return alone; never credit before payment.** Fulfilment runs from the webhook AND the return URL through ONE idempotent function; it checks `payment_status !== "unpaid"` (deferred methods complete the session before the money arrives — `checkout.session.async_payment_succeeded` confirms later).
- **The anti-double-credit guarantee is SQL:** `CreditLot.stripePaymentIntentId @unique` (exists since Phase 1). Event-id dedupe is hygiene, never the guarantee — Stripe can emit two distinct Events for one fact.
- **Webhook payloads are eventually consistent:** handlers re-retrieve the object from the API; the event only says what to re-read. Raw body via `await request.text()` before `constructEvent` — `request.json()` breaks the signature.
- **The client sends a pack slug, never a price or quantity.** The server re-reads the catalogue; `metadata` on Stripe objects is written by our server and still re-validated on the way back.
- **No Stripe Billing Credits, no VAT logic in the consumption path** (single-purpose voucher: VAT at sale). `automatic_tax` + `tax_id_collection` + `invoice_creation` on Checkout; `tax_behavior: "exclusive"` at Price creation (immutable afterwards).
- **One Stripe Customer per organization**, created with `idempotencyKey = "customer:" + organizationId`, id stored on `CreditWallet.stripeCustomerId` (`@unique`, exists). Metadata carries `organizationId`; metadata from the browser is never trusted.
- **Ledger invariants from Phase 1 are binding:** append-only entries; `delta` = signed change to available credits (`pack_purchase +N`, `dispute_freeze −availableInLot`, `dispute_release +availableInLot`, `refund_reversal −availableInLot`); every counter change and its entry in one wallet-locked transaction; a freeze writes off `availableInLot` EXCLUDING held credits (the documented forward constraint in `releaseReservationRow`'s doc block — violating it double-compensates later releases into a negative wallet).
- Constants: `PAID_CREDIT_EXPIRY_DAYS = 365`. Pack ladder from #139 (decided): `starter_25` 25/€99, `hiring_100` 100/€349 (default), `scale_500` 500/€1,490 public; `volume_1000` 1,000/€2,790 **quiet** (purchasable, never listed).
- All flows inert when `CREDIT_BILLING_ENABLED` is off (helper `isCreditBillingEnabled()` from Phase 1, accepts `1|true|yes`). UI additionally requires `isStripePurchaseConfigured()`.
- New env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (unused until Phase 3, stored now), `BILLING_SWEEP_SECRET`. Placeholders in `.env.example`; real values via `dotenvx set … -f .env`.
- Postgres-gated tests keep the Phase 1 pattern (`describe.skipIf(!process.env.TEST_DATABASE_URL)`); Stripe-API-touching tests are additionally gated on `STRIPE_SECRET_KEY` and named `*.stripe.test.ts`. Offline webhook-signature tests use `stripe.webhooks.generateTestHeaderString` — no account needed.
- Schema follows product-side house style (camelCase, `@default(cuid())` where ids are internal, no `@@map`). Console server code lives in `apps/console/src/server/<domain>`; copy for the buy UI goes through `apps/console/public/locales/{en,fr}.json` (react-i18next, like the rest of `settings-billing-section.tsx`).
- **Out of scope (do not build):** SetupIntent/Auto Top-Up (Phase 3), the full "Interview balance" billing UI (Phase 4), expiry-extension-on-repurchase (#139 decision 5, still open), the founding pack (data-only, added later via the sync script), Customer Portal.

## Binding amendments — adversarial architecture + business-rules reviews, 2026-08-15

Two specialist reviews (architecture, HR-SaaS business) challenged this plan before execution. The following amendments are BINDING and override the task text below wherever they conflict. Task briefs must be read together with this section.

**Money-path design fixes (were plan-blockers):**
1. **Dispute/refund functions are status-guarded transitions** (`active→frozen`, `frozen→active|revoked`, `active→revoked`); any other current status returns `{outcome: "already_applied"}` — never a second delta, never `needs_admin` (retries would pile up). Stripe replays events and sends `refund.created` AND `charge.refunded` for one fact; each of the three functions gets a double-delivery test. (Task 7)
2. **The local price cache follows Stripe, never leads it.** In `sync-credit-packs.mjs`, write `unitAmountCents` (and the upsert's price fields) only in the Stripe-confirmed branch; the script FAILS if `PACK_PRICE_OVERRIDES` is provided without `STRIPE_SECRET_KEY`. Products are created with an `Idempotency-Key` derived from the packId (or looked up by `metadata[packId]` first). (Task 1)
3. **The lot records what the customer actually paid.** Checkout metadata carries server-written `credits` + `amountCents` at session creation; fulfilment cross-checks against `session.amount_subtotal` and the catalogue — any divergence → archive `needs_admin`, grant nothing. `grantPurchasedCreditLot` receives the session-derived amount, not the catalogue's current one. (Tasks 4, 5)
4. **P2002 is scoped, not blanket.** After a unique violation, re-read `creditLot.findUnique({ where: { stripePaymentIntentId } })`; found → `already_granted`; absent → rethrow (the violation was another constraint, and answering 200 would stop Stripe's retries on an ungranted payment). (Task 3)

**Resilience and boundaries:**
5. **Missed-event recovery lives in the sweep:** a pass over `GET /v1/events?delivery_success=false&types[]=checkout.session.completed&types[]=checkout.session.async_payment_succeeded` (24 h window) re-calls `fulfillCreditCheckout`. Stripe's retry window (~3 days live, 3 attempts test, then endpoint disablement) goes into the route comment. (Task 9)
6. **Browser-return fulfilment moves out of the server component** into `GET /api/billing/checkout-return` (route handler): authenticate, retrieve the session, **refuse unless `metadata.organizationId` matches the caller's server-side identity** (a `cs_…` search param is attacker input and must not become an enumeration oracle), fulfil, then `redirect("/settings?purchase=<outcome>")` so the param never re-triggers on reload. (Task 8)
7. **The Stripe SDK never crosses into the console:** `@prelude/billing` exports `constructStripeEvent(payload, signature)` (wrapping `webhooks.constructEvent` + secret read); the webhook route imports no `stripe`. (Task 6)
8. **The archive keeps its history:** `StripeWebhookEvent.attemptCount Int @default(1)` incremented on replay, `lastError String?`; the upsert never overwrites a prior `needs_admin`/`failed` status with `processed` silently — transitions are explicit. The sweep response includes `needsAdminCount` and `failedCount`, and a `make billing-admin-queue` target lists those rows: that is the minimum consumer for `needs_admin` until an admin UI exists. (Tasks 1, 6, 9)
9. **The sweep is paginated and mutually exclusive:** `?limit=&cursor=` + `hasMore` in the response, a time budget per invocation, `pg_try_advisory_lock` so overlapping schedules no-op, `curl --max-time` in the make target — and the PR ships a real scheduler config for the chosen deploy target (nothing in the repo schedules anything today; without it Phase 1's activation condition stays open). (Task 9)
10. **Phase 3 is prepared, not blocked:** `stripeCheckoutSessionId` becomes optional on `GrantPurchasedCreditLotInput`; the grant core is `fulfillPaidPaymentIntent(db, { paymentIntentId, packId, … })` with `fulfillCreditCheckout` as the Checkout adapter. `payment_intent_data.setup_future_usage` is deliberately NOT set — card storage requires the explicit Phase 3 mandate flow, never a silent side effect of a purchase. (Tasks 3, 5)
11. **Frozen lots and the clock:** `resolveDisputeOnLot(won)` chains `expireDueLotsInTx` in the same transaction (a lot unfrozen past its `expiresAt` must not resurrect credits the next sweep claws back); `frozenAt DateTime?` is persisted on the lot for a future expiry-extension decision. `charge.dispute.closed` status `warning_closed` maps to the `won` path. (Task 7)
12. **`STRIPE_WEBHOOK_SECRET` is local-only** (each dev's `stripe listen` prints their own; document `.env.local`, never the shared dotenvx `.env`); the checkout re-resolves the Price by `metadata.packId` if the stored `stripePriceId` is inactive (another dev's sync rotated it). (Tasks 1, 4, 10)
13. **EUR is enforced, not implied:** `createCreditCheckoutSession` refuses a pack whose `currency !== "EUR"` with a named error. (Task 4)

**Business-rule amendments (engineering side — the remaining product calls are listed at the end of the plan):**
14. **Reservation TTL drops to 1 hour** (`RESERVATION_TTL_HOURS = 1`, Phase 1 constant): an interview lasts ~8 minutes; five ghost candidates must not empty a First Five wallet for half a day. Resume renews the hold, so slow returners are unaffected. (One-line change + the Phase 1 tests that reference 12 h.)
15. **The balance is never a bare number:** Task 8's loader returns `{ paidAvailable, freeAvailable, nextExpiry: { credits, expiresAt } }` (from `computeWalletTotals`, which already computes them) and the UI renders "X payés · Y offerts" plus "N crédits expirent le D/M/Y". The Checkout success banner and the Stripe invoice line (`invoice_creation.invoice_data.description`) both carry the lot's expiry date. J-30/J-7 expiry emails stay deferred — visibility everywhere is the condition that makes that deferral acceptable.
16. **Dispute freeze notifies the recruiter:** on `charge.dispute.created`, besides freezing, enqueue the existing `@prelude/notifications` email to the organization ("un litige bancaire bloque N crédits — contactez-nous") and archive the event id in it. A frozen customer discovering the block through their candidates is the churn scenario; silence is ours to prevent. (Task 7)
**Product decisions taken 2026-08-15 (user-approved) — binding:**
18. **Billing floor:** `requiredCount = max(3, ceil(planned × 0.5))` — no interview is ever billed under 3 answered questions, whatever the plan length. Implemented as **Task 0** (pre-task): change `evaluateBillableCompletion` in `@prelude/core` (floor was `max(1, …)`), update its tests (the 4-planned/2-answered case flips to NOT billable — pin it), drop `RESERVATION_TTL_HOURS` to 1 (amendment 14) and update the Phase 1 tests that assume 12 h. Additionally, settlement persists `billedAnsweredCount`/`billedRequiredCount` (nullable Ints on `CandidateSession`, columns ride Task 1's migration) and the console candidate detail shows one line — "Facturé : X réponses sur Y" (fr) / "Billed: X of Y answered" (en) — when present: the written trace that wins billing disputes. (New **Task 11**, after Task 8.)
19. **First Five bought-first alignment:** when the wallet is created BY a purchase (no prior billing contact), the `first_five` lot's `expiresAt` aligns with the paid lot's 12 months instead of 30 days — a paying customer's balance never silently shrinks at J+31. Wallets created by an admission keep the 30-day clock. (Task 3: `grantPurchasedCreditLot` signals wallet-creation-by-purchase to `ensureWallet`; test both paths.)
20. **The quiet pack gets its gate:** under the three public packs, the #139 line "Besoin de plus de 500 entretiens ? Obtenez un tarif volume" links straight to the `volume_1000` checkout (the action already accepts any enabled pack). Price stays €2,790 until real data argues otherwise. (Task 8, i18n both locales.)
21. **Refund rule is public and computable:** CGV rule = prorata of unconsumed credits, within 14 days of purchase, once per organization (lawyer validates wording + the L221-28 withdrawal waiver; `consent_collection: { terms_of_service: "required" }` added to Checkout once the CGV URL is configured in Stripe settings). Engineering side (Task 7): a PARTIAL refund whose amount matches `unconsumedCredits × unitAmountCents` (±1 cent rounding) auto-applies — revoke exactly those credits with a `refund_reversal` entry; any other partial amount stays `needs_admin`.

17. **Go-live checklist additions (Task 10 manual step):** verify Stripe Tax has an active FR registration BEFORE the first real checkout (`automatic_tax` without it breaks or zero-rates); configure Stripe Invoice settings with SIREN/RCS, forme sociale, capital, siège, n° TVA intracom, and the L441-9/L441-10 late-payment mentions (footer) — a French DAF rejects invoices without them.

### Phase 1 interfaces this plan consumes (all merged, `packages/billing/src/credit-ledger.ts` / `index.ts`)

```ts
ensureWallet(db, { organizationId, now }): Promise<{ walletId: string }>
FIRST_FIVE_CREDITS = 5; RESERVATION_TTL_HOURS = 12
releaseExpiredReservations(db, { organizationId, now }): Promise<{ releasedCount: number }>
expireDueLots(db, { organizationId, now }): Promise<{ expiredLotIds: string[] }>
reconcileWallet(db, { organizationId }): Promise<{ consistent: boolean; expected: …; actual: … }>
isCreditBillingEnabled(): boolean
// Models: CreditWallet(stripeCustomerId @unique), CreditLot(stripePaymentIntentId/CheckoutSessionId/InvoiceId @unique),
// CreditLedgerEntry(stripeEventId column), lockWallet throws MissingCreditWalletError on absent wallet.
```

---

### Task 1: Schema — `CreditPack` catalogue and `StripeWebhookEvent` archive

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append after `CreditReservation`, no relations to existing models)
- Create: `scripts/sync-credit-packs.mjs`
- Modify: `Makefile` (new target `billing-packs-sync`, add to `.PHONY`)

**Interfaces:**
- Produces: `prisma.creditPack`, `prisma.stripeWebhookEvent`; the seeded four packs; `make billing-packs-sync`.

- [ ] **Step 1: Add the two models**

```prisma
// Phase 2 (#140): the purchasable catalogue. Stripe Products/Prices are the
// price authority; this row maps a stable pack slug to the active Stripe
// price and caches display values. Prices rotate by pointing stripePriceId
// at a new Price — past purchases are never rewritten (their unitAmountCents
// lives on the CreditLot).
model CreditPack {
  id              String   @id // stable slug: starter_25 | hiring_100 | scale_500 | volume_1000
  creditsGranted  Int
  unitAmountCents Int // display cache; Stripe Price is authoritative at checkout
  currency        String   @default("EUR")
  stripeProductId String?  @unique
  stripePriceId   String?  @unique
  visibility      String   @default("public") // public (pricing surfaces) | quiet (purchasable, never listed)
  enabled         Boolean  @default(true)
  displayOrder    Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// Local archive of every received Stripe event: Stripe retains events 30
// days; reconciliation and dispute forensics need longer. Dedupe hygiene
// only — the anti-double-credit guarantee is CreditLot's unique Stripe ids.
model StripeWebhookEvent {
  id            String    @id @default(cuid())
  stripeEventId String    @unique
  type          String
  payload       Json
  status        String    @default("received") // received | processed | ignored | failed | needs_admin
  error         String?
  receivedAt    DateTime  @default(now())
  processedAt   DateTime?

  @@index([type, receivedAt])
}
```

- [ ] **Step 2: Migrate and generate**

Run: `MIGRATION_NAME=add_credit_packs_and_stripe_event_archive make db-migrate && make db-generate`
Expected: applies cleanly; `prisma migrate status` up to date. (Reminder from Phase 1: never hand-write the migration file; let `migrate dev` generate it.)

- [ ] **Step 3: Write the sync script**

`scripts/sync-credit-packs.mjs` — plain Node + `@prisma/client` (same import style as `scripts/e2e-smoke.mjs`), Stripe via raw `fetch` so the root workspace needs no SDK:

```js
// Upserts the #139 pack ladder locally, and — when STRIPE_SECRET_KEY is set —
// ensures each pack has a Stripe Product and an active Price with
// tax_behavior=exclusive (immutable once set). A price change is a NEW Price:
// pass PACK_PRICE_OVERRIDES='{"hiring_100":34900}' to rotate; the old Price is
// deactivated, past lots keep the amount they were bought at.
import { PrismaClient } from "@prisma/client";

const PACKS = [
  { id: "starter_25", creditsGranted: 25, unitAmountCents: 9900, visibility: "public", displayOrder: 1 },
  { id: "hiring_100", creditsGranted: 100, unitAmountCents: 34900, visibility: "public", displayOrder: 2 },
  { id: "scale_500", creditsGranted: 500, unitAmountCents: 149000, visibility: "public", displayOrder: 3 },
  { id: "volume_1000", creditsGranted: 1000, unitAmountCents: 279000, visibility: "quiet", displayOrder: 4 },
];

const stripeKey = process.env.STRIPE_SECRET_KEY;
const overrides = JSON.parse(process.env.PACK_PRICE_OVERRIDES ?? "{}");

async function stripeCall(path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`stripe ${path}: ${body.error?.message ?? response.status}`);
  return body;
}

const prisma = new PrismaClient();
for (const pack of PACKS) {
  const amount = overrides[pack.id] ?? pack.unitAmountCents;
  let { stripeProductId, stripePriceId } =
    (await prisma.creditPack.findUnique({ where: { id: pack.id } })) ?? {};

  if (stripeKey) {
    if (!stripeProductId) {
      const product = await stripeCall("products", {
        name: `HireCall credits — ${pack.creditsGranted} interviews`,
        "metadata[packId]": pack.id,
      });
      stripeProductId = product.id;
    }
    const existing = await prisma.creditPack.findUnique({ where: { id: pack.id } });
    const priceChanged = existing && existing.unitAmountCents !== amount;
    if (!stripePriceId || priceChanged) {
      if (stripePriceId) await stripeCall(`prices/${stripePriceId}`, { active: "false" });
      const price = await stripeCall("prices", {
        product: stripeProductId,
        unit_amount: String(amount),
        currency: "eur",
        tax_behavior: "exclusive",
        "metadata[packId]": pack.id,
      });
      stripePriceId = price.id;
    }
  }

  await prisma.creditPack.upsert({
    where: { id: pack.id },
    create: { ...pack, unitAmountCents: amount, stripeProductId, stripePriceId },
    update: { unitAmountCents: amount, stripeProductId, stripePriceId, visibility: pack.visibility, displayOrder: pack.displayOrder },
  });
  console.log(`${pack.id}: ${amount / 100}€ ${stripePriceId ?? "(local only — no STRIPE_SECRET_KEY)"}`);
}
await prisma.$disconnect();
```

- [ ] **Step 4: Makefile target**

```makefile
billing-packs-sync: ## Upsert the credit pack catalogue; creates Stripe Products/Prices when STRIPE_SECRET_KEY is set.
	@$(LOAD_ENV); node scripts/sync-credit-packs.mjs
```

- [ ] **Step 5: Run both modes and verify**

Run: `node scripts/sync-credit-packs.mjs` (no key → 4 local rows, "(local only)") then `make billing-packs-sync` (dotenvx provides the key → Stripe test-mode products/prices created, ids stored). Verify: `psql … -c 'SELECT id, "stripePriceId", visibility FROM "CreditPack" ORDER BY "displayOrder"'` shows 4 rows, `volume_1000` quiet.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma scripts/sync-credit-packs.mjs Makefile
git commit -m "feat(db): credit pack catalogue and stripe event archive"
```

---

### Task 2: Stripe client module in `@prelude/billing`

**Files:**
- Modify: `packages/billing/package.json` (add `"stripe"` to dependencies, then `pnpm install`)
- Create: `packages/billing/src/stripe-client.ts`
- Create: `packages/billing/src/stripe-client.test.ts`
- Modify: `packages/billing/src/index.ts` (export `getStripeClient`, `isStripePurchaseConfigured`, `MissingStripeConfigError`)

**Interfaces:**
- Produces: `getStripeClient(): Stripe` (throws `MissingStripeConfigError` when unconfigured), `isStripePurchaseConfigured(): boolean`.

- [ ] **Step 1: Failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStripeClient, isStripePurchaseConfigured, MissingStripeConfigError } from "./stripe-client";

afterEach(() => vi.unstubAllEnvs());

describe("stripe client", () => {
  it("reports unconfigured without a secret key and refuses to build a client", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(isStripePurchaseConfigured()).toBe(false);
    expect(() => getStripeClient()).toThrow(MissingStripeConfigError);
  });

  it("rejects a key that is not a secret key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_test_not_a_secret");
    expect(isStripePurchaseConfigured()).toBe(false);
  });

  it("builds a client from a secret key without calling the network", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");
    expect(isStripePurchaseConfigured()).toBe(true);
    expect(getStripeClient()).toBeDefined();
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @prelude/billing exec vitest run src/stripe-client.test.ts` fails (module not found).

- [ ] **Step 3: Implement**

```ts
import Stripe from "stripe";

// The SDK pins its own API version; overriding it here would silently change
// webhook payload shapes on upgrade, so we deliberately do not pass one.
export class MissingStripeConfigError extends Error {
  constructor() {
    super("STRIPE_SECRET_KEY is not configured");
    this.name = "MissingStripeConfigError";
  }
}

export function isStripePurchaseConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_"));
}

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key?.startsWith("sk_")) throw new MissingStripeConfigError();
  return new Stripe(key);
}
```

(No module-level singleton: a fresh instance per call site keeps env stubbing testable and the SDK's agent pooling makes construction cheap. If profiling ever disagrees, memoize then.)

- [ ] **Step 4: GREEN**, then `pnpm --filter @prelude/billing exec tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(billing): stripe client and purchase configuration gate`

---

### Task 3: `grantPurchasedCreditLot` in the ledger

**Files:**
- Modify: `packages/billing/src/credit-ledger.ts`
- Modify: `packages/billing/src/credit-ledger.db.test.ts` (new describe block)
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: `ensureWallet`, the wallet-locked transaction helper (`runInWalletTransaction`), `isUniqueViolation` (P2002 helper, exists).
- Produces:

```ts
export const PAID_CREDIT_EXPIRY_DAYS = 365;
export type GrantPurchasedCreditLotInput = {
  organizationId: string; packId: string; creditsGranted: number;
  unitAmountCents: number; currency: string;
  stripePaymentIntentId: string; stripeCheckoutSessionId: string;
  stripeInvoiceId?: string; stripeEventId?: string; now: Date;
};
grantPurchasedCreditLot(db, input): Promise<{ outcome: "granted"; lotId: string } | { outcome: "already_granted" }>
```

- [ ] **Step 1: Failing db-gated tests** (in the existing gated suite, house helpers `grantedOrganization()` / clock from `Date.now()`):

```ts
describe.skipIf(!databaseUrl)("grantPurchasedCreditLot", () => {
  it("grants a paid lot with its own 12-month expiry and a pack_purchase entry", async () => {
    const organization = await db.organization.create({ data: { name: `buy-${Date.now()}` } });
    const granted = await grantPurchasedCreditLot(db, {
      organizationId: organization.id, packId: "hiring_100", creditsGranted: 100,
      unitAmountCents: 34900, currency: "EUR",
      stripePaymentIntentId: `pi_test_${Date.now()}`, stripeCheckoutSessionId: `cs_test_${Date.now()}`, now,
    });
    expect(granted.outcome).toBe("granted");
    const lot = await db.creditLot.findFirstOrThrow({ where: { organizationId: organization.id, source: "pack_purchase" } });
    expect(lot).toMatchObject({ kind: "paid", creditsGranted: 100, unitAmountCents: 34900, packId: "hiring_100" });
    expect(lot.expiresAt.getTime()).toBe(now.getTime() + PAID_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    // Buying before any admission also materializes the wallet + First Five.
    const wallet = await db.creditWallet.findUniqueOrThrow({ where: { organizationId: organization.id } });
    expect(wallet.availableCredits).toBe(100 + FIRST_FIVE_CREDITS);
    expect((await reconcileWallet(db, { organizationId: organization.id })).consistent).toBe(true);
  });

  it("is idempotent on the payment intent: the same payment delivered twice grants once", async () => {
    const organization = await db.organization.create({ data: { name: `dup-${Date.now()}` } });
    const paymentIntentId = `pi_dup_${Date.now()}`;
    const input = {
      organizationId: organization.id, packId: "starter_25", creditsGranted: 25,
      unitAmountCents: 9900, currency: "EUR",
      stripePaymentIntentId: paymentIntentId, stripeCheckoutSessionId: `cs_dup_${Date.now()}`, now,
    };
    const [first, second] = [await grantPurchasedCreditLot(db, input), await grantPurchasedCreditLot(db, input)];
    expect([first.outcome, second.outcome].sort()).toEqual(["already_granted", "granted"]);
    expect(await db.creditLot.count({ where: { stripePaymentIntentId: paymentIntentId } })).toBe(1);
    expect(await db.creditLedgerEntry.count({ where: { organizationId: organization.id, type: "pack_purchase" } })).toBe(1);
  });
});
```

- [ ] **Step 2: RED** against Postgres (Task 4-era setup commands, database `prelude_credit_test`).

- [ ] **Step 3: Implement** — `ensureWallet` first (outside, like `reserveCreditForSession` does), then one wallet-locked transaction: create the lot (`kind: "paid"`, `source: "pack_purchase"`, `status: "active"`, `grantedAt: now`, `expiresAt: now + 365d`, all Stripe ids), write the `pack_purchase` entry (`delta: +creditsGranted`, `lotId`, `stripeEventId`), increment `wallet.availableCredits`. Catch `isUniqueViolation` around the transaction → `{ outcome: "already_granted" }`; rethrow anything else. Concurrent duplicate deliveries serialize on the wallet lock, so the loser hits P2002 inside its own transaction and rolls back whole — no partial writes.

- [ ] **Step 4: GREEN** both modes (with `TEST_DATABASE_URL`, and skip-clean without), `tsc --noEmit`.

- [ ] **Step 5: Commit** — `feat(billing): grant purchased credit lots idempotently`

---

### Task 4: Customer-per-organization and Checkout session creation

**Files:**
- Create: `packages/billing/src/stripe-purchase.ts`
- Create: `packages/billing/src/stripe-purchase.test.ts`
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: `getStripeClient` (Task 2), `ensureWallet` (Phase 1), `prisma.creditPack` (Task 1).
- Produces:

```ts
ensureStripeCustomer(db, { organizationId, organizationName, now, stripe? }): Promise<{ stripeCustomerId: string }>
createCreditCheckoutSession(db, { organizationId, organizationName, packId, origin, now, stripe? }):
  Promise<{ ok: true; url: string } | { ok: false; error: "unknown_pack" | "pack_not_purchasable" | "not_configured" }>
```
`stripe?` is an injected client for tests (defaults to `getStripeClient()`); `origin` is the console origin for redirect URLs.

- [ ] **Step 1: Failing tests** (fake stripe object; no network):

```ts
const fakeStripe = () => ({
  customers: { create: vi.fn().mockResolvedValue({ id: "cus_1" }) },
  checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }) } },
});

it("creates the customer once with the organization as idempotency key and stores it on the wallet", async () => {
  // fake db: wallet row without stripeCustomerId → expects update with cus_1;
  // second call with stripeCustomerId present → customers.create never called.
});

it("builds a Checkout session with tax, tax-id collection, invoicing and server-owned metadata", async () => {
  const stripe = fakeStripe();
  const result = await createCreditCheckoutSession(db, { organizationId: "org_1", organizationName: "Acme", packId: "hiring_100", origin: "http://localhost:3000", now, stripe });
  expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_1" });
  expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "payment",
      customer: "cus_1",
      line_items: [{ price: "price_hiring", quantity: 1 }],
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      invoice_creation: { enabled: true },
      client_reference_id: "org_1",
      metadata: { organizationId: "org_1", packId: "hiring_100" },
      success_url: "http://localhost:3000/settings?credit_checkout={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:3000/settings?credit_checkout=cancelled",
    }),
  );
});

it("refuses unknown packs, disabled packs, and packs with no Stripe price", async () => {
  // unknown id → unknown_pack; enabled:false OR stripePriceId:null → pack_not_purchasable.
});
```

(A `quiet` pack IS purchasable — visibility only controls listing, per #139.)

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** `ensureStripeCustomer`: `ensureWallet` first; read `wallet.stripeCustomerId`; if absent, `stripe.customers.create({ name, metadata: { organizationId } }, { idempotencyKey: \`customer:${organizationId}\` })` then `creditWallet.update`. The unique column plus Stripe's idempotency key make concurrent calls converge on one customer. `createCreditCheckoutSession`: `isCreditBillingEnabled()` and pack lookup guards → build the session exactly as the test pins.
- [ ] **Step 4: GREEN + tsc.**
- [ ] **Step 5: Commit** — `feat(billing): stripe customer per organization and credit checkout sessions`

---

### Task 5: Idempotent fulfilment

**Files:**
- Create: `packages/billing/src/stripe-fulfilment.ts`
- Create: `packages/billing/src/stripe-fulfilment.test.ts`
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: `grantPurchasedCreditLot` (Task 3), `getStripeClient` (Task 2), `prisma.creditPack`.
- Produces:

```ts
fulfillCreditCheckout(db, { checkoutSessionId, stripeEventId?, now, stripe? }):
  Promise<{ outcome: "granted" | "already_granted" | "not_paid" | "unknown_pack" | "no_payment_intent" }>
```

- [ ] **Step 1: Failing tests** (fake stripe `checkout.sessions.retrieve`):

```ts
it("re-reads the session, validates the pack server-side, and grants once", async () => {
  // retrieve → { id, payment_status: "paid", payment_intent: "pi_1", invoice: "in_1",
  //              metadata: { organizationId: "org_1", packId: "hiring_100" } }
  // catalogue row hiring_100 {creditsGranted: 100, unitAmountCents: 34900} → grant called with
  // the CATALOGUE's credits/amount, never metadata-derived numbers.
});
it("refuses to grant while payment_status is unpaid (deferred methods)", async () => { /* outcome not_paid, grant never called */ });
it("maps a duplicate delivery to already_granted", async () => { /* grant double returns already_granted → passthrough */ });
it("flags a session whose packId no longer exists", async () => { /* unknown_pack, nothing granted */ });
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** `stripe.checkout.sessions.retrieve(checkoutSessionId, { expand: ["payment_intent", "invoice"] })`; `payment_status === "unpaid"` → `not_paid` (Stripe's fulfilment doc: sessions complete before funds arrive on deferred methods; `async_payment_succeeded` calls us again); resolve pack from the LOCAL catalogue by `metadata.packId`; missing/disabled → `unknown_pack` (and `console.error` — money arrived for a pack we can't map; the archive row will carry `needs_admin` via Task 6); extract `payment_intent` id (string or expanded object) → absent → `no_payment_intent`; call `grantPurchasedCreditLot` with catalogue values + Stripe ids + `stripeEventId`.
- [ ] **Step 4: GREEN + tsc.**
- [ ] **Step 5: Commit** — `feat(billing): idempotent checkout fulfilment`

---

### Task 6: Webhook dispatch and the console route

**Files:**
- Create: `packages/billing/src/stripe-webhook.ts` + `packages/billing/src/stripe-webhook.test.ts`
- Create: `apps/console/app/api/stripe/webhook/route.ts` + `apps/console/app/api/stripe/webhook/route.test.ts`
- Modify: `packages/billing/src/index.ts`

**Interfaces:**
- Consumes: `fulfillCreditCheckout` (Task 5), `prisma.stripeWebhookEvent` (Task 1). Task 7 plugs `handleRefundEvent` / `handleDisputeEvent` into this dispatcher.
- Produces:

```ts
handleStripeWebhookEvent(db, event: Stripe.Event, deps?): Promise<{ status: "processed" | "ignored" | "needs_admin" }>
```

- [ ] **Step 1: Failing dispatcher tests.** Archive-first (upsert on `stripeEventId` — a replayed event id updates, never duplicates); `checkout.session.completed` and `checkout.session.async_payment_succeeded` → `fulfillCreditCheckout` with the session id + event id, archive `processed` (or `needs_admin` when fulfilment says `unknown_pack`); `checkout.session.async_payment_failed` / `checkout.session.expired` → archive `processed`, nothing granted; any unknown type → `ignored`. Handler failure → archive `failed` with the error message, then RETHROW (the route's 500 asks Stripe to retry).

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement the dispatcher** (injected `deps = { fulfill: fulfillCreditCheckout, handleRefund?, handleDispute? }` so Task 7 extends without rewiring).
- [ ] **Step 4: Failing route tests — offline signature proof.** Follow the Clerk route's envelope (`apps/console/app/api/clerk/webhook/route.ts`: 400 on bad signature, thin dispatch, 500-for-retry):

```ts
import Stripe from "stripe";
const stripe = new Stripe("sk_test_dummy");
const payload = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } });
const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
// POST with body=payload, stripe-signature=header, STRIPE_WEBHOOK_SECRET=whsec_test → 200, dispatcher called
// POST with a tampered body and the same header → 400, dispatcher never called
// dispatcher throws → 500
```

- [ ] **Step 5: Implement the route.** `const payload = await request.text()` (raw body — `request.json()` breaks the signature); `stripe.webhooks.constructEvent(payload, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)` in try/catch → 400; then `handleStripeWebhookEvent`; 500 on throw. Local dev note in the route comment: `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints the `whsec_…` to put in `.env` via dotenvx.
- [ ] **Step 6: GREEN both files + tsc, commit** — `feat(console): stripe webhook route with archived, idempotent dispatch`

---

### Task 7: Refunds and disputes — minimal, fail-to-admin

**Files:**
- Create: `packages/billing/src/stripe-refunds.ts` + tests (db-gated block in `credit-ledger.db.test.ts` for the money moves; unit tests for routing)
- Modify: `packages/billing/src/credit-ledger.ts` (two new wallet-locked functions), `packages/billing/src/stripe-webhook.ts` (plug handlers), `packages/billing/src/index.ts`

**Interfaces:**
- Produces (ledger): `freezeLotForDispute(db, {stripePaymentIntentId, stripeEventId?, now})`, `resolveDisputeOnLot(db, {stripePaymentIntentId, disposition: "won" | "lost", stripeEventId?, now})`, `revokeUnconsumedLot(db, {stripePaymentIntentId, stripeEventId?, now})` — each returns `{ outcome: "applied" | "no_lot" | "needs_admin" }`.
- Produces (routing): `handleRefundEvent`, `handleDisputeEvent` plugged into Task 6's dispatcher for `refund.created`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.

**Money rules (binding, from #139/#140 + Phase 1 invariants):**
- `charge.dispute.created` → **freeze immediately**: lot `status: "frozen"`, entry `dispute_freeze` with `delta: −availableInLot` (held credits excluded — the forward constraint), wallet decremented. A frozen customer cannot keep spending disputed credits.
- `charge.dispute.closed` `won` → unfreeze: `status: "active"`, `dispute_release` `delta: +availableInLot(now)`; `lost` → `status: "revoked"`, no further delta (the freeze already wrote it off).
- `refund.created` (full refund, `creditsConsumed === 0`, lot active) → `status: "revoked"`, entry `refund_reversal` `delta: −availableInLot`, wallet decremented.
- **Anything else — partial refund, consumed credits, frozen lot, unknown payment intent — is `needs_admin`:** archive the event with that status, `console.error`, change nothing. The wallet must never go negative through an automated path; a human decides.

- [ ] **Step 1: Failing db-gated tests** — freeze excludes held credits (grant 25, hold 1, freeze → wallet available drops by 24, reserved stays 1, reconcile consistent); won-unfreeze restores; lost keeps the write-off; refund of an untouched lot revokes; refund after any consumption → `needs_admin`, nothing changes; all through the public functions, clock-produced states only.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** the three ledger functions (wallet-locked via the existing single transaction wrapper; lot located by `stripePaymentIntentId`), then the two thin routing handlers (retrieve the refund/dispute from the API — payloads are eventually consistent — resolve the payment intent id, call the ledger function, map `needs_admin`).
- [ ] **Step 4: GREEN both modes + tsc.**
- [ ] **Step 5: Commit** — `feat(billing): dispute freeze and refund revocation with admin fallback`

---

### Task 8: Buy surface in the console settings

**Files:**
- Modify: `apps/console/src/server/settings/workspace-settings-data.ts` (load purchasable packs + wallet summary when `isCreditBillingEnabled() && isStripePurchaseConfigured()`)
- Create: `apps/console/src/server/billing/credit-checkout-action.ts` (server action) + test
- Modify: `apps/console/src/features/settings/settings-billing-section.tsx` (flag-gated credit block)
- Modify: `apps/console/src/features/settings/settings-types.ts` (extend `WorkspaceSettingsData`)
- Modify: `apps/console/app/(workspace)/settings/page.tsx` (fulfil on `?credit_checkout=` return)
- Modify: `apps/console/public/locales/en.json` + `fr.json`

**Interfaces:**
- Consumes: `createCreditCheckoutSession`, `fulfillCreditCheckout`, `computeWalletTotals`+lots (balance line), org identity via `getConsoleAuthIdentity` exactly as `workspace-settings-data.ts` already resolves it.
- Produces: `startCreditPackCheckout(packId: string): Promise<{ url?: string; error?: string }>` server action (redirect client-side to `url`).

- [ ] **Step 1: Failing action test** — resolves the org from the SESSION identity (never from client input), passes only `packId` through, refuses when the flag or Stripe config is off, returns the checkout URL.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement action + loader.** Loader returns `creditBilling: { balance: number; packs: Array<{ id; creditsGranted; unitAmountCents }> } | null` — **public packs only** (`visibility: "public"`, ordered by `displayOrder`); the quiet pack stays purchasable through the action for anyone who has its id, per #139.
- [ ] **Step 4: UI block.** Inside `BillingSection`, when `creditBilling` is non-null: balance line (`{count} interviews available`), three pack buttons (name from i18n, price formatted from `unitAmountCents`), each calling the action then `window.location.assign(url)`. Match the section's existing `SettingsPanel` composition and Button variants; no new visual language. i18n keys (`settings.billing.credits.*`) in both locales — French copy in `fr.json`, English in `en.json`.
- [ ] **Step 5: Return handling.** In `settings/page.tsx` (server component): when `searchParams.credit_checkout` is a `cs_…` id, call `fulfillCreditCheckout` (idempotent — the webhook may already have won) and pass a `purchaseOutcome` prop for a one-line banner: granted/already → success copy; `not_paid` → "payment processing" copy (async methods).
- [ ] **Step 6: Tests green** (`pnpm --filter @prelude/console test`), `tsc`, lint. **Commit** — `feat(console): buy credit packs from settings billing`

---

### Task 9: The billing sweep — closes Phase 1's first activation condition

**Files:**
- Create: `apps/console/app/api/internal/billing-sweep/route.ts` + `route.test.ts`
- Modify: `Makefile` (`billing-sweep` target), `.env.example` (`BILLING_SWEEP_SECRET`)

**Interfaces:**
- Consumes: `releaseExpiredReservations`, `expireDueLots`, `reconcileWallet` (Phase 1 — all THROW `MissingCreditWalletError` on wallet-less orgs, so the sweep iterates `creditWallet.findMany` and never guesses).
- Produces: `POST /api/internal/billing-sweep` with `Authorization: Bearer $BILLING_SWEEP_SECRET` → `{ organizationsSwept, holdsReleased, lotsExpired, driftDetected: string[] }`. Any scheduler (Vercel cron, Railway cron, GitHub Actions) can call it; locally `make billing-sweep` curls it.

- [ ] **Step 1: Failing route tests** — 401 without/with wrong bearer; happy path iterates exactly the organizations that HAVE a wallet (injected fakes), aggregates counts, `driftDetected` lists org ids whose `reconcileWallet` came back inconsistent (and the route still returns 200 — drift is a report, not a failure); one org throwing doesn't stop the sweep (error logged, other orgs still swept).
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** (route disabled with 503 when `BILLING_SWEEP_SECRET` unset — fail closed; constant-time compare via `crypto.timingSafeEqual` on equal-length buffers).
- [ ] **Step 4: Makefile target** (the `.env.example` entry for `BILLING_SWEEP_SECRET` already exists — verify, don't duplicate)

```makefile
billing-sweep: ## Release expired credit holds, expire due lots, reconcile wallets (needs console running + BILLING_SWEEP_SECRET).
	@$(LOAD_ENV); curl -sf -X POST -H "Authorization: Bearer $$BILLING_SWEEP_SECRET" http://localhost:3000/api/internal/billing-sweep | node -e 'process.stdin.pipe(process.stdout)'
```

- [ ] **Step 5: GREEN + tsc, commit** — `feat(console): scheduled billing sweep endpoint`

---

### Task 10: Live smoke, env docs, full gate

**Files:**
- Create: `packages/billing/src/stripe-purchase.stripe.test.ts` (gated live test)
- Modify: `.env.example` (Stripe block)

**Interfaces:** consumes everything; produces the merge gate.

- [ ] **Step 1: Gated live test** — `describe.skipIf(!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"))` (refuses to run against a live-mode key by construction): creates a throwaway product + price (`tax_behavior: "exclusive"`) in the sandbox, a customer with the idempotency key (calls twice, asserts same customer id), a Checkout session via `createCreditCheckoutSession` against a temp CreditPack row — asserts a real `https://checkout.stripe.com/...` URL and server-owned metadata; archives nothing. Cleanup: deactivate price, delete product, delete customer, delete the temp pack row.
- [ ] **Step 2: Run it** (keys are in the dotenvx `.env`): `set -a; eval "$(dotenvx get --format eval -f .env)"; set +a; pnpm --filter @prelude/billing exec vitest run src/stripe-purchase.stripe.test.ts` → paste real output.
- [ ] **Step 3: Verify the `.env.example` Stripe block.** It was added when the sandbox keys were stored (commit on main, 2026-08-15): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `BILLING_SWEEP_SECRET`, all with comments. Confirm nothing in this plan introduced an env var missing from it; add any straggler.

- [ ] **Step 4: Full gate** — paste real outputs:

```bash
pnpm typecheck && pnpm lint && pnpm test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/prelude_credit_test pnpm --filter @prelude/billing exec vitest run src/credit-ledger.db.test.ts
```

- [ ] **Step 5: Manual end-to-end (flag on, sandbox):** `make dev` + `stripe listen --forward-to localhost:3000/api/stripe/webhook`; buy `starter_25` with card `4242 4242 4242 4242` from the settings screen; verify: webhook 200, `CreditLot` row with the `pi_…`, wallet +25, invoice visible in the Stripe sandbox dashboard, ledger `pack_purchase +25`, `make billing-sweep` returns cleanly. Then replay the event (`stripe events resend evt_…`) and verify no second lot.
- [ ] **Step 6: Commit** — `chore(billing): stripe env docs and gated live purchase smoke` — and open the PR referencing #140 Phase 2.

---

## After this plan (still open, deliberately)

- **Phase 3** — Auto Top-Up (SetupIntent + mandate, off-session `authentication_required` recovery, `AutoTopUpConfig`/`AutoTopUpAttempt` models). Blocked on Phase 2 shipping.
- **#139 open decisions** that gate go-live, not this plan: First Five abuse control, founding pack, expiry-extension-on-repurchase, and the voice end-to-end run under the flag (Phase 1 condition #2, unchanged).
- **CI Postgres job** for the gated money proofs (Phase 1 condition #3) — infra work, schedule independently.
