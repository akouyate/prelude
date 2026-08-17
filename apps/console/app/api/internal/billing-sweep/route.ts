import { timingSafeEqual } from "node:crypto";
import {
  expireDueLots,
  fulfillCreditCheckout,
  getStripeClient,
  isStripePurchaseConfigured,
  reconcileWallet,
  releaseExpiredReservations,
  reprocessIgnoredStripeEvents,
  type StripeEventReprocessReport,
} from "@prelude/billing";
import { prisma } from "@prelude/db";
import { createNotificationDispatcher } from "@prelude/notifications";
import type { NextRequest } from "next/server";

/**
 * The scheduled billing sweep — the endpoint that closes Phase 1's first
 * activation condition.
 *
 * Phase 1 shipped the ledger's three maintenance transitions
 * (`releaseExpiredReservations`, `expireDueLots`, `reconcileWallet`) and nothing
 * that calls them on a clock. Until something does, a candidate who abandons an
 * interview holds a credit until `RESERVATION_TTL_HOURS` passes AND someone
 * happens to touch that wallet, and a lot past `expiresAt` still reads as
 * spendable. This route is that clock.
 *
 * ── Runbook ────────────────────────────────────────────────────────────────────
 *
 *   POST /api/internal/billing-sweep?limit=<n>&cursor=<organizationId>
 *   Authorization: Bearer $BILLING_SWEEP_SECRET
 *
 * Schedule it AT LEAST HOURLY wherever `CREDIT_BILLING_ENABLED=1`. Generate the
 * secret with `openssl rand -hex 32`; the route answers 503 until it is set, so an
 * environment that forgets it is loudly broken rather than quietly unswept.
 *
 * The repo deploys nowhere yet, so the scheduler that ships with it is
 * `.github/workflows/billing-sweep.yml` — hourly cron, disabled by default behind
 * `vars.BILLING_SWEEP_ENABLED`, `curl --max-time` bounded. Point
 * `BILLING_SWEEP_URL`/`BILLING_SWEEP_SECRET` at the environment that needs
 * sweeping and flip the variable. When a real platform arrives (Vercel Cron,
 * Railway Cron, a k8s CronJob), it replaces the workflow and nothing here changes:
 * the endpoint is deliberately a plain authenticated POST.
 *
 * Locally: `make billing-sweep` (needs the console running). `make
 * billing-admin-queue` lists the rows this response counts as `needsAdminCount` /
 * `failedCount`.
 *
 * ── Response ───────────────────────────────────────────────────────────────────
 *
 * Always 200 once authenticated, and always a report:
 *
 *   { organizationsSwept, organizationsFailed, holdsReleased, lotsExpired,
 *     driftDetected: string[], hasMore, nextCursor,
 *     needsAdminCount, failedCount, reprocessedIgnoredEvents, missedEvents,
 *     durationMs }
 *
 * `driftDetected` is a REPORT, not a failure: a 500 would make the scheduler retry
 * a read-only audit forever and would bury the inconsistency it just found. The
 * same goes for one organization throwing, and for Stripe being unreachable.
 *
 * Deliberately NOT gated on `isCreditBillingEnabled()`. The flag governs whether
 * the product SELLS credits; it does not govern whether credits already sold must
 * expire on time. An environment that flips the flag off still owes its wallets
 * their expiry sweep, and a checkout paid the minute before the flip is still owed
 * its credits.
 */

/** Ordering key for the wallet page — `CreditWallet.organizationId` is `@unique`. */
const DEFAULT_ORGANIZATION_LIMIT = 200;
const MAX_ORGANIZATION_LIMIT = 2_000;

/**
 * How long one invocation may spend on per-organization work before it stops and
 * hands back a cursor. The wallet count is not something this route can predict,
 * so without a budget a growing customer base silently turns an hourly cron into a
 * request that never returns. It must stay comfortably under both the scheduler's
 * `curl --max-time` and `LOCK_TRANSACTION_TIMEOUT_MS` below.
 */
const SWEEP_TIME_BUDGET_MS = 25_000;

/**
 * Mutual exclusion between overlapping schedules.
 *
 * `pg_try_advisory_XACT_lock` rather than the session-level `pg_try_advisory_lock`
 * on purpose, and this is the load-bearing detail: Prisma serves each query from a
 * POOLED connection, so a session-level lock would be taken on one connection and
 * `pg_advisory_unlock`ed on another — a no-op — leaking the lock for the lifetime
 * of the pool and wedging every future sweep. The xact variant is released by the
 * transaction, so it cannot outlive a crash, a timeout or a redeploy.
 *
 * The transaction exists ONLY to pin a connection for the lock's lifetime; the
 * sweep's own work runs on the pooled client inside it. That is safe because this
 * lock is about scheduler overlap, not data consistency — each ledger call takes
 * its own wallet lock. It does mean the pool needs at least two connections, which
 * every default (`num_cpus * 2 + 1`) satisfies.
 */
const BILLING_SWEEP_LOCK_CLASS = 0x6863; // 'hc' — HireCall
const BILLING_SWEEP_LOCK_OBJECT = 1; // billing sweep
const LOCK_TRANSACTION_TIMEOUT_MS = 60_000;
const LOCK_MAX_WAIT_MS = 2_000;

/**
 * Amendment 5 — the missed-event recovery pass.
 *
 * Stripe retries a failing webhook for ~3 days and then DISABLES the endpoint. An
 * outage longer than that window, or an endpoint disabled while nobody was
 * looking, loses paid checkouts that Stripe will never redeliver. The only way
 * back is to ask Stripe what it failed to deliver and fulfil it ourselves.
 *
 * Bounded to one page of the newest events on purpose: `delivery_success` reflects
 * WEBHOOK delivery, not our fulfilment, so a re-fulfilled event keeps showing up
 * here. Re-scanning the same newest hundred every hour is the intended, cheap
 * steady state — this is a safety net behind the webhook and the browser return,
 * and every call into `fulfillCreditCheckout` is idempotent through the ledger's
 * unique payment intent.
 */
const MISSED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
] as const;
const MISSED_EVENT_WINDOW_SECONDS = 24 * 60 * 60;
const MISSED_EVENT_SCAN_LIMIT = 100;

/**
 * Wired here, not inside `@prelude/billing`, for the reason the webhook route
 * spells out: the dispatcher reaches for the Prisma singleton and pulls React and
 * the email provider with it, and moving money must not depend on any of that.
 */
const notificationDispatcher = createNotificationDispatcher();

type MissedEventReport = {
  failed: number;
  granted: number;
  scanned: number;
  skipped: boolean;
};

type BillingSweepReport = {
  driftDetected: string[];
  durationMs: number;
  failedCount: number;
  hasMore: boolean;
  holdsReleased: number;
  lotsExpired: number;
  missedEvents: MissedEventReport;
  needsAdminCount: number;
  nextCursor: string | null;
  organizationsFailed: number;
  organizationsSwept: number;
  reprocessedIgnoredEvents: StripeEventReprocessReport;
};

export async function POST(request: NextRequest) {
  if (!isAuthorizedSweepCaller(request)) {
    return sweepAuthFailure();
  }

  const page = readPageRequest(request.nextUrl.searchParams);
  if (page === null) {
    return new Response("Invalid limit or cursor", { status: 400 });
  }

  const startedAt = Date.now();
  const outcome = await withSweepLock(() => runSweep(page, startedAt));

  if (!outcome.acquired) {
    // 200, not 409. An hourly cron over a sweep that may legitimately run for tens
    // of seconds WILL overlap, and that overlap is the lock working as designed —
    // not an incident. A 409 would fail `curl -sf` and page someone every time.
    console.warn("[billing-sweep] another sweep holds the advisory lock; skipping");
    return Response.json({ durationMs: Date.now() - startedAt, skipped: true });
  }

  return Response.json(outcome.report);
}

// ---------------------------------------------------------------------------
// Authentication — fail closed.
// ---------------------------------------------------------------------------

/**
 * A route handler under `app/api` is reachable by anyone unless something stops
 * them, and this one drives the credit ledger's expiry machinery. So: 503 while
 * the secret is unset (an unset secret must never mean "everything matches"), 401
 * for everything that does not present it, and a constant-time compare in between
 * so the token cannot be recovered a byte at a time.
 */
function isAuthorizedSweepCaller(request: NextRequest): boolean {
  const expected = process.env.BILLING_SWEEP_SECRET?.trim();
  if (!expected) return false;

  const header = request.headers.get("authorization")?.trim() ?? "";
  const [scheme, ...rest] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return false;

  const presented = rest.join(" ");
  const presentedBuffer = Buffer.from(presented, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  // `timingSafeEqual` THROWS on unequal lengths, so the length check comes first.
  // It leaks the secret's length and nothing else, which is not a secret.
  if (presentedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(presentedBuffer, expectedBuffer);
}

function sweepAuthFailure(): Response {
  if (!process.env.BILLING_SWEEP_SECRET?.trim()) {
    console.error("[billing-sweep] refused: BILLING_SWEEP_SECRET is not configured");
    return new Response("Billing sweep is not configured", { status: 503 });
  }
  return new Response("Unauthorized", { status: 401 });
}

// ---------------------------------------------------------------------------
// Pagination.
// ---------------------------------------------------------------------------

type PageRequest = { cursor: string | null; limit: number };

/** `null` means "the caller sent something we will not guess at" → 400. */
function readPageRequest(params: URLSearchParams): PageRequest | null {
  const rawLimit = params.get("limit");
  let limit = DEFAULT_ORGANIZATION_LIMIT;
  if (rawLimit !== null) {
    // A silent clamp would make a typo'd `?limit=100000` look like it worked.
    if (!/^\d+$/.test(rawLimit.trim())) return null;
    limit = Number(rawLimit.trim());
    if (limit < 1 || limit > MAX_ORGANIZATION_LIMIT) return null;
  }

  const cursor = params.get("cursor")?.trim();
  return { cursor: cursor ? cursor : null, limit };
}

// ---------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------

async function withSweepLock(
  run: () => Promise<BillingSweepReport>,
): Promise<{ acquired: false } | { acquired: true; report: BillingSweepReport }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          ${BILLING_SWEEP_LOCK_CLASS}::int4,
          ${BILLING_SWEEP_LOCK_OBJECT}::int4
        ) AS locked
      `;
      if (rows[0]?.locked !== true) return { acquired: false as const };
      return { acquired: true as const, report: await run() };
    },
    { maxWait: LOCK_MAX_WAIT_MS, timeout: LOCK_TRANSACTION_TIMEOUT_MS },
  );
}

async function runSweep(page: PageRequest, startedAt: number): Promise<BillingSweepReport> {
  const now = new Date();
  // Every organization's maintenance runs against ONE clock. Sweeping with a fresh
  // `new Date()` per organization would make the batch's own duration part of the
  // expiry decision, so the same reservation could be released or not depending on
  // where it sat in the page.

  /*
   * The account-wide passes run only on the scheduler's ENTRY call (no cursor).
   * Repeating a Stripe listing and an archive backfill on every continuation page
   * would multiply them by the number of pages for no recovery value — they are
   * already bounded and idempotent, and the next hourly entry call runs them again.
   * The archive DEPTH is two cheap counts, so every response carries it.
   */
  const isEntryCall = page.cursor === null;
  const reprocessedIgnoredEvents = isEntryCall
    ? await reprocessIgnoredStripeEvents(prisma, { deps: { notifyDisputeFrozen } })
    : { failed: 0, needsAdmin: 0, processed: 0, reprocessed: 0, stillIgnored: 0 };
  const missedEvents = isEntryCall
    ? await recoverMissedCheckoutEvents(now)
    : { failed: 0, granted: 0, scanned: 0, skipped: true };

  const [needsAdminCount, failedCount] = await Promise.all([
    prisma.stripeWebhookEvent.count({ where: { status: "needs_admin" } }),
    prisma.stripeWebhookEvent.count({ where: { status: "failed" } }),
  ]);

  // `take: limit + 1` answers "is there another page" without a second query.
  const rows = await prisma.creditWallet.findMany({
    orderBy: { organizationId: "asc" },
    select: { organizationId: true },
    take: page.limit + 1,
    ...(page.cursor === null
      ? {}
      : { cursor: { organizationId: page.cursor }, skip: 1 }),
  });
  const wallets = rows.slice(0, page.limit);

  const driftDetected: string[] = [];
  let organizationsSwept = 0;
  let organizationsFailed = 0;
  let holdsReleased = 0;
  let lotsExpired = 0;
  let nextCursor = page.cursor;
  let truncatedByBudget = false;

  for (const { organizationId } of wallets) {
    if (Date.now() - startedAt > SWEEP_TIME_BUDGET_MS) {
      truncatedByBudget = true;
      break;
    }

    // The cursor advances even when the organization throws. A wallet whose
    // maintenance fails deterministically must not become a barrier that starves
    // every organization ordered after it — the failure is counted and logged, and
    // the next invocation gets past it.
    nextCursor = organizationId;
    try {
      const released = await releaseExpiredReservations(prisma, { now, organizationId });
      holdsReleased += released.releasedCount;

      const expired = await expireDueLots(prisma, { now, organizationId });
      lotsExpired += expired.expiredLotIds.length;

      // Read-only audit, deliberately last: it should see the state the two sweeps
      // above just produced, so drift it reports is real and not mid-sweep noise.
      const reconciliation = await reconcileWallet(prisma, { organizationId });
      if (!reconciliation.consistent) {
        driftDetected.push(organizationId);
        console.error("[billing-sweep] wallet does not reconcile", {
          actual: reconciliation.actual,
          expected: reconciliation.expected,
          organizationId,
        });
      }

      organizationsSwept += 1;
    } catch (error) {
      // A wallet deleted mid-sweep (`MissingCreditWalletError`), a lock timeout, a
      // dropped connection. One organization's problem is not the batch's.
      organizationsFailed += 1;
      console.error("[billing-sweep] sweeping one organization failed", {
        error: describeError(error),
        organizationId,
      });
    }
  }

  const hasMore = truncatedByBudget || rows.length > page.limit;

  return {
    driftDetected,
    durationMs: Date.now() - startedAt,
    failedCount,
    hasMore,
    holdsReleased,
    lotsExpired,
    missedEvents,
    needsAdminCount,
    nextCursor: hasMore ? nextCursor : null,
    organizationsFailed,
    organizationsSwept,
    reprocessedIgnoredEvents,
  };
}

/**
 * Amendment 16's notifier, in the shape `@prelude/billing` asks for. Identical
 * construction to the webhook route's, because a dispute recovered by the sweep
 * owes the recruiter the same notice as one delivered live — arguably more, since
 * it has been open and silent since the row was archived.
 */
function notifyDisputeFrozen({
  frozenCredits,
  organizationId,
  stripeEventId,
}: {
  frozenCredits: number;
  lotId: string;
  organizationId: string;
  stripeEventId: string;
}) {
  return notificationDispatcher.notifyCreditDisputeFrozen({
    frozenCredits,
    organizationId,
    stripeEventId,
  });
}

async function recoverMissedCheckoutEvents(now: Date): Promise<MissedEventReport> {
  if (!isStripePurchaseConfigured()) {
    // Not a failure. Most environments (CI, a fresh clone, any console without
    // Stripe keys) have nothing to recover, and constructing a client without a
    // key would throw `MissingStripeConfigError` on a scheduled endpoint.
    return { failed: 0, granted: 0, scanned: 0, skipped: true };
  }

  const report: MissedEventReport = { failed: 0, granted: 0, scanned: 0, skipped: false };

  let events: readonly unknown[];
  try {
    const stripe = getStripeClient();
    const listing = await stripe.events.list({
      created: { gte: Math.floor(now.getTime() / 1000) - MISSED_EVENT_WINDOW_SECONDS },
      delivery_success: false,
      limit: MISSED_EVENT_SCAN_LIMIT,
      types: [...MISSED_EVENT_TYPES],
    });
    events = listing.data;
  } catch (error) {
    // Stripe being unreachable must not discard the per-organization sweep that
    // already ran, and must not make the scheduler retry the whole invocation.
    report.failed += 1;
    console.error("[billing-sweep] listing undelivered Stripe events failed", {
      error: describeError(error),
    });
    return report;
  }

  for (const event of events) {
    report.scanned += 1;
    const identity = readEventIdentity(event);
    if (identity === null) {
      // An event whose object is not a `cs_…` cannot be fulfilled as a checkout.
      // Nothing to do and nothing to alarm about — counted as scanned, no more.
      continue;
    }

    try {
      const outcome = await fulfillCreditCheckout(prisma, {
        checkoutSessionId: identity.checkoutSessionId,
        // No `expectedOrganizationId`: the sweep is authenticated by its own
        // bearer, not by a browser session, and is legitimately allowed to fulfil
        // for any organization. Passing one would refuse every event.
        now,
        stripeEventId: identity.stripeEventId,
      });
      if (outcome.outcome === "granted") report.granted += 1;
    } catch (error) {
      report.failed += 1;
      console.error("[billing-sweep] re-fulfilling an undelivered event failed", {
        error: describeError(error),
        stripeEventId: identity.stripeEventId,
      });
    }
  }

  return report;
}

/**
 * Narrows Stripe's event union structurally rather than importing its types. Keeps
 * amendment 7's line intact: `stripe` stays out of the console, and
 * `@prelude/billing` remains the only place that knows the SDK's shapes.
 */
function readEventIdentity(
  event: unknown,
): { checkoutSessionId: string; stripeEventId: string } | null {
  if (typeof event !== "object" || event === null) return null;
  const { data, id } = event as { data?: unknown; id?: unknown };
  if (typeof id !== "string" || typeof data !== "object" || data === null) return null;

  const { object } = data as { object?: unknown };
  if (typeof object !== "object" || object === null) return null;

  const sessionId = (object as { id?: unknown }).id;
  if (typeof sessionId !== "string" || !sessionId.startsWith("cs_")) return null;

  return { checkoutSessionId: sessionId, stripeEventId: id };
}

/** Message only — never the error object, which on a Stripe error carries the payload. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
