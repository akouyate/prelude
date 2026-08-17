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

// Clock-active says nothing about remaining credits — only that the lot
// hasn't expired or been deactivated. Balance aggregates need this weaker
// notion: a fully-reserved lot (availableInLot === 0) is not eligible for
// consumption, but it is still holding real reserved credits that must
// stay in the wallet's totals.
export function isLotClockActive(lot: CreditLotSnapshot, now: Date): boolean {
  return lot.status === "active" && lot.expiresAt > now;
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
  // Available sums span clock-active lots only: an expired or deactivated lot has
  // nothing left to spend, whatever its counters say.
  const clockActive = lots.filter((lot) => isLotClockActive(lot, now));
  const available = clockActive.reduce((sum, lot) => sum + availableInLot(lot), 0);
  // Reserved is summed over EVERY lot, with no filter at all. Reserve, capture and
  // release move the lot counter and the wallet counter in lockstep, so the sum of
  // `creditsReserved` across all lots is exactly the wallet's reserved total — a lot
  // holding no reservations contributes 0, so no filter is needed and any filter is
  // wrong. In particular an expired or frozen lot can still carry live holds (the
  // expiry sweep deliberately leaves `creditsReserved` intact so held credits are not
  // written off twice), and those holds stay real for up to the reservation TTL.
  const reserved = lots.reduce((sum, lot) => sum + lot.creditsReserved, 0);
  const freeAvailable = clockActive
    .filter((lot) => lot.kind === "free")
    .reduce((sum, lot) => sum + availableInLot(lot), 0);
  // nextExpiry warns about available credits that are about to be lost, so
  // it stays scoped to lots that actually have credits left to lose.
  const eligible = lots.filter((lot) => isLotEligible(lot, now));
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
