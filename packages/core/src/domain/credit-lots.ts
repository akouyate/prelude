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
