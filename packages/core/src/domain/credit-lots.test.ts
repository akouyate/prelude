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
    // Exact-equality boundary: expiresAt === now must be treated as already
    // expired (strict `>`), not eligible-until-and-including now.
    expect(isLotEligible(lot({ expiresAt: now }), now)).toBe(false);
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

  it("breaks a kind/expiresAt tie by the older grantedAt", () => {
    const newerGrant = lot({ id: "e", grantedAt: new Date("2026-06-01T00:00:00Z") });
    const olderGrant = lot({ id: "d", grantedAt: new Date("2025-01-01T00:00:00Z") });
    const sorted = [newerGrant, olderGrant].sort(compareLotsForConsumption);
    expect(sorted.map((entry) => entry.id)).toEqual(["d", "e"]);
  });

  it("breaks a kind/expiresAt/grantedAt tie by the lexicographically smaller id", () => {
    const idHigh = lot({ id: "z" });
    const idLow = lot({ id: "a" });
    const sorted = [idHigh, idLow].sort(compareLotsForConsumption);
    expect(sorted.map((entry) => entry.id)).toEqual(["a", "z"]);
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

  it("counts reserved credits of a fully-reserved lot in wallet totals", () => {
    // A lot with nothing left to give out (available === 0) is not eligible
    // for consumption, but it is still holding real reserved credits that
    // the wallet's `reserved` total must not drop.
    const totals = computeWalletTotals(
      [lot({ id: "full", creditsGranted: 5, creditsReserved: 5 })],
      now,
    );
    expect(totals).toEqual({
      available: 0,
      reserved: 5,
      freeAvailable: 0,
      paidAvailable: 0,
      // No available credits are at risk of being lost, so this lot must not
      // surface as the next expiry warning.
      nextExpiry: null,
    });
  });
});
