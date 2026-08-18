import "server-only";

import {
  isCreditBillingEnabled,
  isStripePurchaseConfigured,
} from "@prelude/billing";
import {
  computeWalletTotals,
  isLotClockActive,
  type CreditLotSnapshot,
} from "@prelude/core";
import { prisma } from "@prelude/db";
import type { EnterpriseNavCredits } from "@prelude/ui";
import type { TFunction } from "i18next";

import { getServerT } from "../../libs/i18n-server";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { getAuthenticatedUserLocale } from "../users/user-locale";

const topUpHref = "/settings?view=billing";

/**
 * The sidebar credit meter (nav-credit-meter task), or `null` when there is
 * nothing to show. Same dual-flag gate as `loadCreditBilling` in
 * workspace-settings-data.ts, for the same reason: `isCreditBillingEnabled`
 * is the product kill switch, `isStripePurchaseConfigured` says whether this
 * deployment has a Stripe secret key configured at all.
 *
 * Scope resolution mirrors `getWorkspaceNavCounts` — it lets a missing scope
 * throw rather than swallowing it, since the workspace layout already
 * requires completed onboarding before either loader runs.
 */
export async function getWorkspaceCreditSummary(): Promise<EnterpriseNavCredits | null> {
  if (!isCreditBillingEnabled() || !isStripePurchaseConfigured()) {
    return null;
  }

  const scope = await getCompletedOrganizationScope();
  const locale = await getAuthenticatedUserLocale();
  const t = getServerT(locale);
  const lots = await prisma.creditLot.findMany({
    select: {
      id: true,
      kind: true,
      status: true,
      creditsGranted: true,
      creditsConsumed: true,
      creditsReserved: true,
      grantedAt: true,
      expiresAt: true,
    },
    where: { organizationId: scope.organizationId },
  });

  return toWorkspaceCreditSummary(lots, new Date(), t, locale);
}

/**
 * The pure half: `available` and `nextExpiry` come straight out of
 * `computeWalletTotals` — the same function the settings page and the
 * reservation path use — so the nav can never disagree with them about what
 * "available" means. `totalGranted` is the one figure that function does not
 * already expose: `creditsGranted` summed over the same clock-active lots,
 * via the shared `isLotClockActive` predicate rather than a re-implementation.
 *
 * `lots` takes the loose Prisma-shaped rows (same convention as
 * `toWorkspaceCreditBilling`) rather than `CreditLotSnapshot[]` directly, so
 * callers don't have to fight `kind`/`status` widening to `string` at the
 * query boundary.
 */
export function toWorkspaceCreditSummary(
  lots: Array<{
    id: string;
    kind: string;
    status: string;
    creditsGranted: number;
    creditsConsumed: number;
    creditsReserved: number;
    grantedAt: Date;
    expiresAt: Date;
  }>,
  now: Date,
  // `t` and the locale are passed in rather than resolved here so this stays a
  // pure function: it is unit-tested directly, and reading the request's user
  // would drag an auth round trip into it.
  t: TFunction,
  locale: string,
): EnterpriseNavCredits {
  const snapshots = lots as CreditLotSnapshot[];
  const totals = computeWalletTotals(snapshots, now);
  const totalGranted = snapshots
    .filter((lot) => isLotClockActive(lot, now))
    .reduce((sum, lot) => sum + lot.creditsGranted, 0);

  return {
    available: totals.available,
    low: totalGranted === 0 || totals.available / totalGranted <= 0.2,
    nextExpiryLabel: totals.nextExpiry
      ? t("shell.creditsExpiring", {
          count: totals.nextExpiry.credits,
          date: formatExpiryDate(totals.nextExpiry.expiresAt, locale),
        })
      : null,
    topUpHref,
    totalGranted,
  };
}

// Was pinned to "en-US", so a French recruiter read "Sep 14" in an otherwise
// French sidebar. The locale now follows the reader.
function formatExpiryDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
  }).format(date);
}
