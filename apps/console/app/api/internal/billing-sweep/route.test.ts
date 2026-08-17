import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sweep is a money-adjacent cron endpoint, so the fakes are deliberately
 * shallow: every collaborator is a house `vi.hoisted` mock, and the assertions are
 * about WHICH organizations were touched, what was aggregated, and what the
 * bearer check refused — never about ledger arithmetic, which is already pinned by
 * `credit-ledger.db.test.ts` in `@prelude/billing`.
 */
const txMock = vi.hoisted(() => ({ $queryRaw: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  creditWallet: { findMany: vi.fn() },
  stripeWebhookEvent: { count: vi.fn() },
}));

const billingMock = vi.hoisted(() => ({
  expireDueLots: vi.fn(),
  fulfillCreditCheckout: vi.fn(),
  getStripeClient: vi.fn(),
  isStripePurchaseConfigured: vi.fn(),
  reconcileWallet: vi.fn(),
  releaseExpiredReservations: vi.fn(),
  reprocessIgnoredStripeEvents: vi.fn(),
}));

/**
 * A STABLE reference, on purpose. The T7 handoff requires the sweep to thread the
 * very notifier the webhook route wires, so the test has to be able to prove the
 * function it handed `reprocessIgnoredStripeEvents` reaches this one.
 */
const disputeNotifier = vi.hoisted(() => vi.fn());

const notificationsMock = vi.hoisted(() => ({
  createNotificationDispatcher: vi.fn(() => ({
    notifyCreditDisputeFrozen: disputeNotifier,
  })),
}));

vi.mock("@prelude/db", () => ({ prisma: prismaMock }));
vi.mock("@prelude/billing", () => billingMock);
vi.mock("@prelude/notifications", () => notificationsMock);

import { POST } from "./route";

const SECRET = "sweep_secret_value";

/** The route reads only `headers` and `nextUrl`, so that is all the fake carries. */
function sweepRequest({
  authorization = `Bearer ${SECRET}`,
  query = "",
}: { authorization?: string | null; query?: string } = {}) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return {
    headers,
    nextUrl: new URL(`https://console.test/api/internal/billing-sweep${query}`),
  } as unknown as Parameters<typeof POST>[0];
}

function walletPage(...organizationIds: string[]) {
  return organizationIds.map((organizationId) => ({ organizationId }));
}

const emptyReprocessReport = {
  failed: 0,
  needsAdmin: 0,
  processed: 0,
  reprocessed: 0,
  stillIgnored: 0,
};

beforeEach(() => {
  vi.stubEnv("BILLING_SWEEP_SECRET", SECRET);

  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation(
    async (run: (tx: typeof txMock) => Promise<unknown>) => run(txMock),
  );
  txMock.$queryRaw.mockReset();
  txMock.$queryRaw.mockResolvedValue([{ locked: true }]);

  prismaMock.creditWallet.findMany.mockReset();
  prismaMock.creditWallet.findMany.mockResolvedValue([]);
  prismaMock.stripeWebhookEvent.count.mockReset();
  prismaMock.stripeWebhookEvent.count.mockResolvedValue(0);

  billingMock.releaseExpiredReservations.mockReset();
  billingMock.releaseExpiredReservations.mockResolvedValue({ releasedCount: 0 });
  billingMock.expireDueLots.mockReset();
  billingMock.expireDueLots.mockResolvedValue({ expiredLotIds: [] });
  billingMock.reconcileWallet.mockReset();
  billingMock.reconcileWallet.mockResolvedValue({
    actual: { available: 0, reserved: 0 },
    consistent: true,
    expected: { available: 0, reserved: 0 },
  });
  billingMock.reprocessIgnoredStripeEvents.mockReset();
  billingMock.reprocessIgnoredStripeEvents.mockResolvedValue({ ...emptyReprocessReport });
  billingMock.fulfillCreditCheckout.mockReset();
  billingMock.fulfillCreditCheckout.mockResolvedValue({ lotId: "lot_1", outcome: "granted" });
  billingMock.isStripePurchaseConfigured.mockReset();
  billingMock.isStripePurchaseConfigured.mockReturnValue(false);
  billingMock.getStripeClient.mockReset();

  disputeNotifier.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/internal/billing-sweep — authentication", () => {
  /**
   * Fail CLOSED. An unset secret on a public-by-default route handler would mean
   * `Bearer undefined` matched, i.e. the whole internet could drive the ledger's
   * expiry machinery. 503 rather than 401 because the endpoint is misconfigured,
   * not the caller.
   */
  it("is disabled with 503 when BILLING_SWEEP_SECRET is unset, and does no work", async () => {
    vi.stubEnv("BILLING_SWEEP_SECRET", "");

    const response = await POST(sweepRequest());

    expect(response.status).toBe(503);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only secret as unset", async () => {
    vi.stubEnv("BILLING_SWEEP_SECRET", "   ");

    const response = await POST(sweepRequest({ authorization: "Bearer    " }));

    expect(response.status).toBe(503);
    expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a caller with no Authorization header", async () => {
    const response = await POST(sweepRequest({ authorization: null }));

    expect(response.status).toBe(401);
    expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer of the SAME length", async () => {
    // Same length on purpose: this is the input `timingSafeEqual` exists for, and
    // the only one that proves the compare is not an early-exit `===`.
    const wrong = `${"x".repeat(SECRET.length - 1)}y`;
    expect(wrong).toHaveLength(SECRET.length);

    const response = await POST(sweepRequest({ authorization: `Bearer ${wrong}` }));

    expect(response.status).toBe(401);
    expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
  });

  it("refuses a wrong bearer of a different length without throwing", async () => {
    // `timingSafeEqual` THROWS on unequal-length buffers, so a length guard has to
    // come first or a short token becomes a 500 instead of a 401.
    const response = await POST(sweepRequest({ authorization: "Bearer short" }));

    expect(response.status).toBe(401);
  });

  it("refuses a non-Bearer scheme carrying the right secret", async () => {
    const response = await POST(sweepRequest({ authorization: `Basic ${SECRET}` }));

    expect(response.status).toBe(401);
  });

  it("accepts the correct bearer", async () => {
    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
  });
});

describe("POST /api/internal/billing-sweep — per-organization work", () => {
  /**
   * The Phase 1 functions THROW `MissingCreditWalletError` for an organization
   * with no wallet, so the sweep may never guess at the organization list: it
   * iterates the wallets themselves.
   */
  it("sweeps exactly the organizations that HAVE a wallet", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_2"));

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      organizationsFailed: 0,
      organizationsSwept: 2,
    });
    for (const organizationId of ["org_1", "org_2"]) {
      expect(billingMock.releaseExpiredReservations).toHaveBeenCalledWith(prismaMock, {
        now: expect.any(Date),
        organizationId,
      });
      expect(billingMock.expireDueLots).toHaveBeenCalledWith(prismaMock, {
        now: expect.any(Date),
        organizationId,
      });
      expect(billingMock.reconcileWallet).toHaveBeenCalledWith(prismaMock, { organizationId });
    }
  });

  it("aggregates released holds and expired lots across organizations", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_2"));
    billingMock.releaseExpiredReservations
      .mockResolvedValueOnce({ releasedCount: 3 })
      .mockResolvedValueOnce({ releasedCount: 4 });
    billingMock.expireDueLots
      .mockResolvedValueOnce({ expiredLotIds: ["lot_a"] })
      .mockResolvedValueOnce({ expiredLotIds: ["lot_b", "lot_c"] });

    const response = await POST(sweepRequest());

    await expect(bodyOf(response)).resolves.toMatchObject({
      holdsReleased: 7,
      lotsExpired: 3,
      organizationsSwept: 2,
    });
  });

  /**
   * Drift is a REPORT, not a failure. A 500 here would make the scheduler retry a
   * read-only audit forever and would hide the very inconsistency it found.
   */
  it("lists inconsistent organizations in driftDetected and still returns 200", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_ok", "org_drift"));
    billingMock.reconcileWallet.mockImplementation(
      async (_db: unknown, { organizationId }: { organizationId: string }) => ({
        actual: { available: organizationId === "org_drift" ? 9 : 0, reserved: 0 },
        consistent: organizationId !== "org_drift",
        expected: { available: 0, reserved: 0 },
      }),
    );

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      driftDetected: ["org_drift"],
      organizationsSwept: 2,
    });
  });

  it("keeps sweeping after one organization throws, and reports the failure", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_boom", "org_3"));
    billingMock.releaseExpiredReservations.mockImplementation(
      async (_db: unknown, { organizationId }: { organizationId: string }) => {
        if (organizationId === "org_boom") throw new Error("wallet vanished mid-sweep");
        return { releasedCount: 1 };
      },
    );

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      holdsReleased: 2,
      organizationsFailed: 1,
      organizationsSwept: 2,
    });
    expect(billingMock.reconcileWallet).toHaveBeenCalledWith(prismaMock, {
      organizationId: "org_3",
    });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("POST /api/internal/billing-sweep — pagination and time budget", () => {
  it("caps a page at ?limit and reports hasMore with a resumable cursor", async () => {
    // The route asks for limit + 1 so "is there a next page" costs no extra query.
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_2", "org_3"));

    const response = await POST(sweepRequest({ query: "?limit=2" }));

    expect(prismaMock.creditWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { organizationId: "asc" }, take: 3 }),
    );
    await expect(bodyOf(response)).resolves.toMatchObject({
      hasMore: true,
      nextCursor: "org_2",
      organizationsSwept: 2,
    });
  });

  it("reports hasMore false and a null cursor when the page is the last one", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1"));

    const response = await POST(sweepRequest({ query: "?limit=2" }));

    await expect(bodyOf(response)).resolves.toMatchObject({
      hasMore: false,
      nextCursor: null,
      organizationsSwept: 1,
    });
  });

  it("resumes after ?cursor and skips the cursor row itself", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_3"));

    await POST(sweepRequest({ query: "?cursor=org_2" }));

    expect(prismaMock.creditWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { organizationId: "org_2" }, skip: 1 }),
    );
  });

  it("rejects a limit that is not a positive integer", async () => {
    for (const query of ["?limit=0", "?limit=-1", "?limit=abc", "?limit=1.5", "?limit=100000"]) {
      prismaMock.creditWallet.findMany.mockClear();

      const response = await POST(sweepRequest({ query }));

      expect(response.status).toBe(400);
      expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
    }
  });

  /**
   * The named time budget is what keeps one invocation inside the scheduler's
   * `--max-time`: a workspace count we cannot predict must not turn into a request
   * that never returns. Stopping early is reported as `hasMore`, never as an error.
   */
  it("stops when the time budget is spent and hands back the resume cursor", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_2", "org_3"));
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Two organizations at 20s each overruns any sane per-invocation budget.
    billingMock.releaseExpiredReservations.mockImplementation(async () => {
      clock += 20_000;
      return { releasedCount: 0 };
    });

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      hasMore: true,
      nextCursor: "org_2",
      organizationsSwept: 2,
    });
    expect(billingMock.reconcileWallet).not.toHaveBeenCalledWith(prismaMock, {
      organizationId: "org_3",
    });
  });

  /**
   * FORWARD PROGRESS — the property that makes the paginated chain terminate.
   *
   * The entry passes share the same budget clock, so on an entry call they can
   * legitimately leave none of it. If the loop checked the budget before its first
   * attempt, this invocation would sweep zero organizations and answer `hasMore: true`
   * with the cursor it was handed — and the scheduler would follow that cursor into
   * the identical response forever, releasing not one hold.
   */
  it("still attempts one organization when the entry passes exhausted the budget", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1", "org_2", "org_3"));
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // The Stripe listing alone blows the whole per-invocation budget.
    billingMock.isStripePurchaseConfigured.mockReturnValue(true);
    billingMock.getStripeClient.mockReturnValue({
      events: {
        list: vi.fn().mockImplementation(async () => {
          clock += 60_000;
          return { data: [] };
        }),
      },
    });

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    const body = await bodyOf(response);
    // Exactly one attempt: index 0 is unconditional, index 1 sees the spent budget.
    expect(body).toMatchObject({ hasMore: true, nextCursor: "org_1", organizationsSwept: 1 });
    expect(billingMock.releaseExpiredReservations).toHaveBeenCalledTimes(1);
  });

  /**
   * The invariant the test above protects, stated directly: `hasMore: true` with a
   * null cursor is a scheduler that can never advance, so it must be unreachable
   * across every shape of page.
   */
  it("never answers hasMore without a cursor to resume from", async () => {
    const clockCases = [0, 60_000];
    for (const perOrgCost of clockCases) {
      for (const page of [[], ["org_1"], ["org_1", "org_2"], ["org_1", "org_2", "org_3"]]) {
        for (const limit of [1, 2]) {
          prismaMock.creditWallet.findMany.mockResolvedValue(walletPage(...page));
          let clock = 0;
          vi.spyOn(Date, "now").mockImplementation(() => clock);
          billingMock.releaseExpiredReservations.mockImplementation(async () => {
            clock += perOrgCost;
            return { releasedCount: 0 };
          });

          const body = await bodyOf(await POST(sweepRequest({ query: `?limit=${limit}` })));

          if (body.hasMore === true) {
            expect(body.nextCursor).not.toBeNull();
          }
        }
      }
    }
  });
});

describe("POST /api/internal/billing-sweep — entry-pass time budget", () => {
  /**
   * The missed-event pass yields PARTWAY rather than running to the end of Stripe's
   * page. Each iteration is a session read plus a possible ledger write, so a hundred
   * of them is not a bounded cost in wall time — and it must not spend the budget the
   * per-organization sweep exists to use.
   */
  it("yields partway through the Stripe page and reports how far it got", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    billingMock.isStripePurchaseConfigured.mockReturnValue(true);
    billingMock.getStripeClient.mockReturnValue({
      events: {
        list: vi.fn().mockResolvedValue({
          data: ["cs_1", "cs_2", "cs_3", "cs_4"].map((id, index) => ({
            data: { object: { id } },
            id: `evt_${index + 1}`,
            type: "checkout.session.completed",
          })),
        }),
      },
    });
    // 4s per event against a 10s entry-pass budget: three fit, the fourth does not.
    billingMock.fulfillCreditCheckout.mockImplementation(async () => {
      clock += 4_000;
      return { lotId: "lot_x", outcome: "granted" };
    });

    const response = await POST(sweepRequest());

    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { granted: 3, scanned: 3, skipped: null, yieldedToBudget: true },
    });
    expect(billingMock.fulfillCreditCheckout).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("yielded to the time budget"),
      { scanned: 3 },
    );
  });

  it("does not run the reprocess pass when the budget is already spent", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // The auth + parse path burns the entry-pass budget before the sweep begins.
    prismaMock.$transaction.mockImplementation(
      async (run: (tx: typeof txMock) => Promise<unknown>) => {
        clock += 30_000;
        return run(txMock);
      },
    );

    const response = await POST(sweepRequest());

    expect(billingMock.reprocessIgnoredStripeEvents).not.toHaveBeenCalled();
    await expect(bodyOf(response)).resolves.toMatchObject({
      reprocessedIgnoredEvents: { failed: 0, reprocessed: 0 },
    });
  });

  it("reports scanned counts truthfully — a yield never claims an unprocessed event", async () => {
    let clock = 0;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    billingMock.isStripePurchaseConfigured.mockReturnValue(true);
    billingMock.getStripeClient.mockReturnValue({
      events: {
        list: vi.fn().mockImplementation(async () => {
          // The listing itself consumes the whole entry-pass budget.
          clock += 20_000;
          return {
            data: [
              { data: { object: { id: "cs_1" } }, id: "evt_1", type: "checkout.session.completed" },
            ],
          };
        }),
      },
    });

    const response = await POST(sweepRequest());

    // Zero scanned, not one: the check precedes the work.
    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { granted: 0, scanned: 0, yieldedToBudget: true },
    });
    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/billing-sweep — mutual exclusion", () => {
  /**
   * Overlapping schedules are the NORMAL case for an hourly cron over a sweep that
   * may run for tens of seconds, so the loser answers 200 `{ skipped: true }`
   * rather than 409: a scheduler running `curl -sf` must not page anyone for
   * behaving exactly as designed.
   */
  it("no-ops with 200 { skipped: true } when another sweep holds the lock", async () => {
    txMock.$queryRaw.mockResolvedValue([{ locked: false }]);

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({ skipped: true });
    expect(prismaMock.creditWallet.findMany).not.toHaveBeenCalled();
    expect(billingMock.reprocessIgnoredStripeEvents).not.toHaveBeenCalled();
  });

  it("takes the lock inside a transaction so it cannot outlive a crash", async () => {
    await POST(sweepRequest());

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const [sql] = txMock.$queryRaw.mock.calls[0] as [{ raw?: string[] } | string[]];
    expect(JSON.stringify(sql)).toContain("pg_try_advisory_xact_lock");
  });

  /**
   * The ordering invariant, asserted rather than commented.
   *
   * If the lock's transaction times out first, Prisma rolls it back and RELEASES the
   * advisory lock while this invocation is still writing on the pooled client — the
   * work is deliberately outside the transaction, so it survives the lock's death and
   * a second scheduler walks straight in. The margin must also cover the one
   * operation already in flight when a budget check trips.
   */
  it("keeps the lock transaction strictly longer than every budget it must outlast", async () => {
    await POST(sweepRequest());

    const [, options] = prismaMock.$transaction.mock.calls[0] as [
      unknown,
      { maxWait: number; timeout: number },
    ];
    const SWEEP_TIME_BUDGET_MS = 25_000;
    const ENTRY_PASS_TIME_BUDGET_MS = 10_000;

    expect(ENTRY_PASS_TIME_BUDGET_MS).toBeLessThan(SWEEP_TIME_BUDGET_MS);
    expect(options.timeout).toBeGreaterThan(SWEEP_TIME_BUDGET_MS + ENTRY_PASS_TIME_BUDGET_MS);
    expect(options.maxWait).toBeLessThan(options.timeout);
  });

  /**
   * The OUTERMOST leg of the same invariant, and the only one that lives outside
   * TypeScript. Both schedulers must give the server longer than its own lock
   * transaction, so this reads the two files rather than trusting a comment to keep
   * them in step — the failure it prevents (curl abandoning a sweep that then keeps
   * the lock, and a retry reading the resulting `skipped` as an anomaly) is invisible
   * from inside the route.
   */
  it("keeps both schedulers' --max-time strictly above the lock transaction timeout", async () => {
    await POST(sweepRequest());
    const [, options] = prismaMock.$transaction.mock.calls[0] as [unknown, { timeout: number }];
    const lockTimeoutSeconds = options.timeout / 1000;

    const repoRoot = new URL("../../../../../../", import.meta.url);
    const makefile = readFileSync(new URL("Makefile", repoRoot), "utf8");
    const workflow = readFileSync(new URL(".github/workflows/billing-sweep.yml", repoRoot), "utf8");

    const makeMaxTime = Number(/^BILLING_SWEEP_MAX_TIME \?= (\d+)$/m.exec(makefile)?.[1]);
    const workflowMaxTime = Number(/^\s*CURL_MAX_TIME: "(\d+)"$/m.exec(workflow)?.[1]);

    expect(makeMaxTime).toBeGreaterThan(lockTimeoutSeconds);
    expect(workflowMaxTime).toBeGreaterThan(lockTimeoutSeconds);
  });
});

describe("POST /api/internal/billing-sweep — failure modes", () => {
  /**
   * Postgres unreachable, pool exhausted (P2024), lock transaction timed out (P2028).
   * Next's default would be an opaque HTML error page: the scheduler logs "500" with
   * no cause, and `--fail-with-body` pastes a stack trace into the job output.
   */
  it("answers a logged JSON 500 when the sweep cannot run at all", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("Can't reach database server"));

    const response = await POST(sweepRequest());

    expect(response.status).toBe(500);
    await expect(bodyOf(response)).resolves.toMatchObject({ error: "sweep_failed" });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(console.error).toHaveBeenCalledWith(
      "[billing-sweep] the sweep could not run",
      expect.objectContaining({ error: expect.stringContaining("database") }),
    );
  });

  /**
   * Prisma's keyset pagination needs the cursor ROW to locate the boundary, so a
   * wallet deleted between two pages silently truncates the rest of the chain. It
   * must not look like "there was nothing to do".
   */
  it("logs when a resume cursor no longer resolves to a page", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue([]);

    const response = await POST(sweepRequest({ query: "?cursor=org_deleted" }));

    expect(response.status).toBe(200);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("resume cursor returned no page"),
      { cursor: "org_deleted" },
    );
  });

  it("does not log a missing-cursor warning for an empty entry call", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue([]);

    await POST(sweepRequest());

    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("resume cursor returned no page"),
      expect.anything(),
    );
  });

  it("names only the limit in the 400, since the cursor is not validated", async () => {
    const response = await POST(sweepRequest({ query: "?limit=0" }));

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("limit");
    expect(text.toLowerCase()).not.toContain("cursor");
  });
});

describe("POST /api/internal/billing-sweep — archive queue and T7 handoff", () => {
  it("reports the admin queue depth from the webhook archive", async () => {
    prismaMock.stripeWebhookEvent.count.mockImplementation(
      async ({ where }: { where: { status: string } }) =>
        where.status === "needs_admin" ? 2 : where.status === "failed" ? 5 : 0,
    );

    const response = await POST(sweepRequest());

    await expect(bodyOf(response)).resolves.toMatchObject({
      failedCount: 5,
      needsAdminCount: 2,
    });
  });

  it("reprocesses the events Task 6 archived as ignored and reports the outcome", async () => {
    billingMock.reprocessIgnoredStripeEvents.mockResolvedValue({
      failed: 1,
      needsAdmin: 2,
      processed: 3,
      reprocessed: 6,
      stillIgnored: 0,
    });

    const response = await POST(sweepRequest());

    expect(billingMock.reprocessIgnoredStripeEvents).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ deps: expect.any(Object) }),
    );
    await expect(bodyOf(response)).resolves.toMatchObject({
      reprocessedIgnoredEvents: {
        failed: 1,
        needsAdmin: 2,
        processed: 3,
        reprocessed: 6,
        stillIgnored: 0,
      },
    });
  });

  /**
   * A backfilled `charge.dispute.created` freezes a wallet exactly as a live one
   * does, so it owes the recruiter the same notice (amendment 16). `deps` is
   * required by design; this proves the sweep passes the SAME dispatcher the
   * webhook route wires rather than an empty object.
   */
  it("threads the console's dispute notifier into the reprocess pass", async () => {
    await POST(sweepRequest());

    const [, input] = billingMock.reprocessIgnoredStripeEvents.mock.calls[0] as [
      unknown,
      {
        deps: {
          notifyDisputeFrozen: (input: {
            frozenCredits: number;
            lotId: string;
            organizationId: string;
            stripeEventId: string;
          }) => Promise<unknown>;
        };
      },
    ];
    await input.deps.notifyDisputeFrozen({
      frozenCredits: 3,
      lotId: "lot_9",
      organizationId: "org_1",
      stripeEventId: "evt_1",
    });

    expect(disputeNotifier).toHaveBeenCalledWith({
      frozenCredits: 3,
      organizationId: "org_1",
      stripeEventId: "evt_1",
    });
  });

  it("does not reprocess on a continuation call, which is per-organization work only", async () => {
    await POST(sweepRequest({ query: "?cursor=org_2" }));

    expect(billingMock.reprocessIgnoredStripeEvents).not.toHaveBeenCalled();
    // The archive depth is cheap, so EVERY response still carries it.
    expect(prismaMock.stripeWebhookEvent.count).toHaveBeenCalled();
  });
});

describe("POST /api/internal/billing-sweep — missed Stripe events", () => {
  function stripeClientListing(events: unknown[]) {
    const list = vi.fn().mockResolvedValue({ data: events });
    billingMock.isStripePurchaseConfigured.mockReturnValue(true);
    billingMock.getStripeClient.mockReturnValue({ events: { list } });
    return list;
  }

  it("skips the Stripe pass cleanly when purchases are unconfigured", async () => {
    billingMock.isStripePurchaseConfigured.mockReturnValue(false);

    const response = await POST(sweepRequest());

    expect(billingMock.getStripeClient).not.toHaveBeenCalled();
    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { granted: 0, scanned: 0, skipped: "unconfigured" },
    });
  });

  it("re-fulfils undelivered checkout events from the last 24 hours", async () => {
    const list = stripeClientListing([
      { data: { object: { id: "cs_1" } }, id: "evt_1", type: "checkout.session.completed" },
      {
        data: { object: { id: "cs_2" } },
        id: "evt_2",
        type: "checkout.session.async_payment_succeeded",
      },
    ]);

    const response = await POST(sweepRequest());

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_success: false,
        types: ["checkout.session.completed", "checkout.session.async_payment_succeeded"],
      }),
    );
    // A 24h window, expressed in Stripe's unix seconds.
    const [params] = list.mock.calls[0] as [{ created: { gte: number } }];
    const windowSeconds = Math.floor(Date.now() / 1000) - params.created.gte;
    expect(windowSeconds).toBeGreaterThanOrEqual(86_395);
    expect(windowSeconds).toBeLessThanOrEqual(86_405);

    // Idempotent by the ledger's unique payment intent, so re-calling fulfilment
    // for a session the webhook already handled is safe and is the whole point.
    expect(billingMock.fulfillCreditCheckout).toHaveBeenCalledWith(prismaMock, {
      checkoutSessionId: "cs_1",
      now: expect.any(Date),
      stripeEventId: "evt_1",
    });
    expect(billingMock.fulfillCreditCheckout).toHaveBeenCalledWith(prismaMock, {
      checkoutSessionId: "cs_2",
      now: expect.any(Date),
      stripeEventId: "evt_2",
    });
    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { failed: 0, granted: 2, scanned: 2, skipped: null },
    });
  });

  it("never passes an expectedOrganizationId — the sweep fulfils for any organization", async () => {
    stripeClientListing([
      { data: { object: { id: "cs_1" } }, id: "evt_1", type: "checkout.session.completed" },
    ]);

    await POST(sweepRequest());

    const [, input] = billingMock.fulfillCreditCheckout.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(input).not.toHaveProperty("expectedOrganizationId");
  });

  it("ignores an event whose object is not a checkout session id", async () => {
    stripeClientListing([
      { data: { object: { id: "pi_1" } }, id: "evt_1", type: "checkout.session.completed" },
      { data: { object: {} }, id: "evt_2", type: "checkout.session.completed" },
    ]);

    const response = await POST(sweepRequest());

    expect(billingMock.fulfillCreditCheckout).not.toHaveBeenCalled();
    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { granted: 0, scanned: 2, skipped: null },
    });
  });

  it("counts one event's failure and keeps going", async () => {
    stripeClientListing([
      { data: { object: { id: "cs_1" } }, id: "evt_1", type: "checkout.session.completed" },
      { data: { object: { id: "cs_2" } }, id: "evt_2", type: "checkout.session.completed" },
    ]);
    billingMock.fulfillCreditCheckout
      .mockRejectedValueOnce(new Error("stripe is down"))
      .mockResolvedValueOnce({ lotId: "lot_2", outcome: "granted" });

    const response = await POST(sweepRequest());

    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { failed: 1, granted: 1, scanned: 2, skipped: null },
    });
  });

  /**
   * Stripe being unreachable is not a reason to lose the per-organization sweep
   * that already ran, nor to make the scheduler retry the whole invocation.
   */
  it("still returns 200 with the organization results when the Stripe listing throws", async () => {
    prismaMock.creditWallet.findMany.mockResolvedValue(walletPage("org_1"));
    billingMock.isStripePurchaseConfigured.mockReturnValue(true);
    billingMock.getStripeClient.mockReturnValue({
      events: { list: vi.fn().mockRejectedValue(new Error("network")) },
    });

    const response = await POST(sweepRequest());

    expect(response.status).toBe(200);
    await expect(bodyOf(response)).resolves.toMatchObject({
      missedEvents: { failed: 1, scanned: 0, skipped: null },
      organizationsSwept: 1,
    });
  });
});
