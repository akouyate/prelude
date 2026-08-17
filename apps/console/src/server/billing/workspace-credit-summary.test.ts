import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toWorkspaceCreditSummary } from "./workspace-credit-summary";

/**
 * The nav meter's pure half. `available` and the next-expiry figure are
 * re-derived straight from `computeWalletTotals` (@prelude/core) — never
 * recomputed here — so the sidebar can never disagree with Settings or the
 * ledger about what "available" means. `totalGranted` is the one new number:
 * `creditsGranted` summed over the same clock-active lots.
 */
describe("toWorkspaceCreditSummary", () => {
  const now = new Date("2026-08-15T09:00:00.000Z");

  function lot(overrides: Record<string, unknown> = {}) {
    return {
      id: "lot_1",
      kind: "paid",
      status: "active",
      creditsGranted: 100,
      creditsConsumed: 0,
      creditsReserved: 0,
      grantedAt: new Date("2026-08-01T09:00:00.000Z"),
      expiresAt: new Date("2027-08-01T09:00:00.000Z"),
      ...overrides,
    };
  }

  it("sums available and totalGranted over active lots only, ignoring expired, exhausted and frozen ones", () => {
    const result = toWorkspaceCreditSummary(
      [
        lot({ id: "lot_active", creditsGranted: 80, creditsConsumed: 20 }),
        lot({
          id: "lot_expired",
          creditsGranted: 50,
          expiresAt: new Date("2026-08-01T09:00:00.000Z"),
        }),
        lot({
          id: "lot_exhausted",
          status: "exhausted",
          creditsGranted: 30,
          creditsConsumed: 30,
        }),
        lot({ id: "lot_frozen", status: "frozen", creditsGranted: 20 }),
      ],
      now,
    );

    expect(result.totalGranted).toBe(80);
    expect(result.available).toBe(60);
  });

  it("treats reserved credits as unavailable without pulling them out of totalGranted", () => {
    // A reservation shrinks `available` but the lot is still clock-active, so
    // the bar's used fraction (totalGranted - available) counts the hold.
    const result = toWorkspaceCreditSummary(
      [lot({ creditsGranted: 100, creditsConsumed: 10, creditsReserved: 30 })],
      now,
    );

    expect(result.totalGranted).toBe(100);
    expect(result.available).toBe(60);
  });

  it("is low exactly at the 20% boundary and not just above it", () => {
    const atBoundary = toWorkspaceCreditSummary(
      [lot({ creditsGranted: 100, creditsConsumed: 80 })],
      now,
    );
    const justAbove = toWorkspaceCreditSummary(
      [lot({ creditsGranted: 100, creditsConsumed: 79 })],
      now,
    );

    expect(atBoundary.low).toBe(true);
    expect(justAbove.low).toBe(false);
  });

  it("reads an empty wallet as zero and low, with nothing to top up against", () => {
    const result = toWorkspaceCreditSummary([], now);

    expect(result).toMatchObject({
      available: 0,
      totalGranted: 0,
      low: true,
      nextExpiryLabel: null,
    });
  });

  it("formats the soonest expiry as an en-US month/day label", () => {
    const result = toWorkspaceCreditSummary(
      [
        lot({
          id: "lot_expiring",
          kind: "free",
          creditsGranted: 12,
          expiresAt: new Date("2026-12-01T09:00:00.000Z"),
        }),
        lot({ id: "lot_far", expiresAt: new Date("2027-06-01T09:00:00.000Z") }),
      ],
      now,
    );

    expect(result.nextExpiryLabel).toBe("12 expiring Dec 1");
  });

  it("omits the expiry label when no lot is eligible to expire away credits", () => {
    const result = toWorkspaceCreditSummary(
      [lot({ creditsConsumed: 100 })],
      now,
    );

    expect(result.nextExpiryLabel).toBeNull();
  });

  it("points Top up at the billing view of Settings", () => {
    const result = toWorkspaceCreditSummary([lot()], now);

    expect(result.topUpHref).toBe("/settings?view=billing");
  });
});
