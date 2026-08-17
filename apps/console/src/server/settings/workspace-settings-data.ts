import "server-only";

import {
  getWorkspaceBillingOverview,
  syncClerkOrganizationBilling,
} from "@prelude/billing/server";
import {
  isCreditBillingEnabled,
  isStripePurchaseConfigured,
  type WorkspaceBilling,
} from "@prelude/billing";
import { computeWalletTotals, type CreditLotSnapshot } from "@prelude/core";
import { prisma, type Prisma } from "@prelude/db";
import { readWorkspaceNotificationPreferences } from "@prelude/notifications/preferences";
import type { OrganizationRole } from "@prelude/types";
import { headers } from "next/headers";

import {
  canManageTeam,
  canPurchaseCredits,
} from "../../domain/organization-permissions";
import { getConsoleAuthIdentity } from "../auth/console-auth-provider";
import { clerkOrganizationDirectory } from "../organizations/clerk-organization-directory";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import { resolveDisplayCurrencyFromRequest } from "../../features/settings/settings-billing-helpers";
import type {
  SettingsInterviewPreferences,
  SettingsNotificationPreferences,
  WorkspaceCreditBilling,
  WorkspaceSettingsData,
} from "../../features/settings/settings-types";
import { coerceConsoleLocale } from "../../libs/i18n-server";
import {
  googleOAuthAvailable,
  listConnectedAccountSummaries,
} from "../integrations/connected-account-service";

const defaultInterviewPreferences: SettingsInterviewPreferences = {
  allowAudio: true,
  allowForm: true,
  autoGenerateTranscript: true,
  defaultLanguage: "en",
  interviewerVoice: "maya",
  requireRecordingConsent: true,
  showReviewGuardrail: true,
};

export async function getWorkspaceSettingsData(): Promise<WorkspaceSettingsData> {
  const [identity, scope] = await Promise.all([
    getConsoleAuthIdentity(),
    getCompletedOrganizationScope(),
  ]);

  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const canManage = canManageTeam(scope.role);

  const [
    organization,
    draftCount,
    publishedCount,
    activeRoleCount,
    needsReviewCount,
    user,
    pendingInvitations,
    connectedAccounts,
    billingOverview,
    creditBilling,
  ] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      include: {
        jobSourceConnections: {
          orderBy: { createdAt: "desc" },
        },
        memberships: {
          include: {
            user: true,
          },
          orderBy: { createdAt: "asc" },
          where: { status: "active" },
        },
      },
      where: { id: scope.organizationId },
    }),
    prisma.interviewDraft.count({
      where: {
        organizationId: scope.organizationId,
        status: "draft",
      },
    }),
    prisma.interview.count({
      where: {
        organizationId: scope.organizationId,
        status: "published",
      },
    }),
    prisma.job.count({
      where: { organizationId: scope.organizationId },
    }),
    prisma.candidateSession.count({
      where: {
        organizationId: scope.organizationId,
        reviewStatus: "to_review",
        status: "completed",
      },
    }),
    prisma.user.findUnique({
      select: { preferredLanguage: true },
      where: { id: scope.userId },
    }),
    loadPendingInvitations(canManage, scope.clerkOrganizationId),
    listConnectedAccountSummaries({
      organizationId: scope.organizationId,
      userId: scope.userId,
    }),
    loadWorkspaceBillingOverview({
      clerkOrganizationId: scope.clerkOrganizationId,
      organizationId: scope.organizationId,
    }),
    loadCreditBilling({ organizationId: scope.organizationId, role: scope.role }),
  ]);

  const preferences = parseOrganizationSettings(organization.settings);
  const isGoogleOAuthAvailable = googleOAuthAvailable();

  const viewerClerkUserId =
    organization.memberships.find(
      (membership) => membership.userId === scope.userId,
    )?.user.clerkUserId ?? "";

  return {
    account: {
      email: identity.value.userEmail,
      name: identity.value.userName,
      preferredLanguage: coerceConsoleLocale(user?.preferredLanguage),
      role: scope.role,
    },
    authProvider: identity.value.source,
    billing: toWorkspaceSettingsBilling({
      authProvider: identity.value.source,
      billing: billingOverview.billing,
      canManageBilling: canManageWorkspaceBilling({
        authProvider: identity.value.source,
        role: scope.role,
      }),
      usage: billingOverview.usage,
    }),
    creditBilling,
    connectedAccounts: connectedAccounts.map((account) => ({
      capabilities: account.capabilities,
      connectedAt: account.connectedAt?.toISOString() ?? null,
      disconnectedAt: account.disconnectedAt?.toISOString() ?? null,
      externalAccountEmail: account.externalAccountEmail,
      externalAccountId: account.externalAccountId,
      provider: account.provider,
      scopes: account.scopes,
      status: account.status,
    })),
    connectors: organization.jobSourceConnections.map((connector) => ({
      provider: connector.provider,
      status: connector.status,
    })),
    integrationAvailability: {
      googleOAuth: isGoogleOAuthAvailable,
    },
    interviewPreferences: preferences.interview,
    metrics: {
      activeRoles: activeRoleCount,
      needsReview: needsReviewCount,
      published: publishedCount,
      drafts: draftCount,
    },
    notificationPreferences: preferences.notifications,
    organization: {
      companySize: organization.companySize,
      country: organization.country,
      defaultInterviewMode: organization.defaultInterviewMode,
      hiringFocus: organization.hiringFocus,
      name: organization.name,
    },
    team: organization.memberships.map((membership) => ({
      clerkUserId: membership.user.clerkUserId,
      email: membership.user.email,
      id: membership.id,
      name: membership.user.name ?? membership.user.email,
      role: membership.role,
      status: membership.status,
    })),
    canManageTeam: canManage,
    viewerClerkUserId,
    pendingInvitations,
  };
}

export function canManageWorkspaceBilling({
  authProvider,
  role,
}: {
  authProvider: "clerk" | "mock";
  role: string;
}) {
  return authProvider === "clerk" && role === "owner";
}

async function loadWorkspaceBillingOverview({
  clerkOrganizationId,
  organizationId,
}: {
  clerkOrganizationId: string | null;
  organizationId: string;
}) {
  let overview = await getWorkspaceBillingOverview({ organizationId });

  if (overview.billing.state !== "unavailable" || !clerkOrganizationId) {
    return overview;
  }

  try {
    await syncClerkOrganizationBilling({ clerkOrganizationId });
    overview = await getWorkspaceBillingOverview({ organizationId });
  } catch (error) {
    console.error("[settings] failed to bootstrap Clerk Billing", error);
  }

  return overview;
}

/**
 * The prepaid-credit buy surface (#140), or `null` when there is nothing to sell.
 *
 * Both flags matter, and for different reasons: `isCreditBillingEnabled` is the
 * product kill switch, `isStripePurchaseConfigured` says whether this deployment
 * has a secret key at all. Rendering prices without the second one would give a
 * recruiter buttons that can only fail.
 *
 * Read scoped by organization, like every other console read.
 */
async function loadCreditBilling({
  organizationId,
  role,
}: {
  organizationId: string;
  role: OrganizationRole;
}): Promise<WorkspaceCreditBilling | null> {
  if (!isCreditBillingEnabled() || !isStripePurchaseConfigured()) {
    return null;
  }

  // Plan rule 4: resolved from THIS request's headers, not from
  // `Organization.country` (never read here or anywhere in this file) and not
  // from the browser — the client seeds its toggle from this value instead of
  // reading `navigator.language` after hydration, which is what killed the
  // currency-symbol flash on first paint.
  const requestHeaders = await headers();
  const initialDisplayCurrency = resolveDisplayCurrencyFromRequest(requestHeaders);

  const [lots, packs] = await Promise.all([
    prisma.creditLot.findMany({
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
      where: { organizationId },
    }),
    prisma.creditPack.findMany({
      select: {
        id: true,
        creditsGranted: true,
        unitAmountCents: true,
        unitAmountCentsUsd: true,
        visibility: true,
        enabled: true,
        displayOrder: true,
      },
      // The quiet pack is fetched too: it is never listed, but amendment 20's
      // volume line needs its id to open a checkout.
      where: { enabled: true },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  return {
    ...toWorkspaceCreditBilling({ lots, packs, now: new Date(), role }),
    initialDisplayCurrency,
  };
}

/**
 * The pure half of the above: totals from `@prelude/core` (the same function the
 * ledger uses, so the settings page and the reservation path can never disagree
 * about what "available" means) plus the catalogue split into what may be listed
 * and what may only be linked.
 *
 * Deliberately currency-agnostic: `initialDisplayCurrency` (plan rule 4) is a
 * per-REQUEST signal resolved by the async caller (`loadCreditBilling`, which
 * has to await `headers()`), not something this pure function — driven only by
 * lots/packs/role — should need to thread through.
 */
export function toWorkspaceCreditBilling({
  lots,
  packs,
  now,
  role,
}: {
  lots: Array<{
    id: string;
    kind: string;
    status: string;
    creditsGranted: number;
    creditsConsumed: number;
    creditsReserved: number;
    grantedAt: Date;
    expiresAt: Date;
  }>;
  packs: Array<{
    id: string;
    creditsGranted: number;
    unitAmountCents: number;
    unitAmountCentsUsd: number | null;
    visibility: string;
    enabled: boolean;
    displayOrder: number;
  }>;
  now: Date;
  role: OrganizationRole;
}): Omit<WorkspaceCreditBilling, "initialDisplayCurrency"> {
  const totals = computeWalletTotals(lots as CreditLotSnapshot[], now);
  const sellable = [...packs]
    .filter((pack) => pack.enabled)
    .sort((left, right) => left.displayOrder - right.displayOrder);

  return {
    // A hint for the UI, never the enforcement: the action and the return route
    // re-derive this from the session and refuse on their own.
    canPurchase: canPurchaseCredits(role),
    paidAvailable: totals.paidAvailable,
    freeAvailable: totals.freeAvailable,
    nextExpiry: totals.nextExpiry
      ? {
          credits: totals.nextExpiry.credits,
          expiresAt: totals.nextExpiry.expiresAt.toISOString(),
        }
      : null,
    packs: sellable
      .filter((pack) => pack.visibility === "public")
      .map((pack) => ({
        id: pack.id,
        creditsGranted: pack.creditsGranted,
        unitAmountCents: pack.unitAmountCents,
        unitAmountCentsUsd: pack.unitAmountCentsUsd,
      })),
    volumePackId: sellable.find((pack) => pack.visibility === "quiet")?.id ?? null,
  };
}

export function toWorkspaceSettingsBilling({
  authProvider,
  billing,
  canManageBilling,
  usage,
}: {
  authProvider: "clerk" | "mock";
  billing: WorkspaceBilling;
  canManageBilling: boolean;
  usage: {
    candidateInterviews: number;
    publishedRoles: number;
  };
}): WorkspaceSettingsData["billing"] {
  const unmetered = billing.state === "unconfigured";

  return {
    canManageBilling: canManageBilling && !unmetered,
    manageBillingUnavailableReason: unmetered
      ? "not_configured"
      : authProvider === "mock"
        ? "local_mock"
        : canManageBilling
          ? null
          : "not_owner",
    entitlements: {
      recording: billing.entitlements.recording,
    },
    limits: {
      candidateInterviews: unmetered
        ? null
        : billing.entitlements.candidateInterviewLimit,
      publishedRoles: unmetered ? null : billing.entitlements.activeRoleLimit,
    },
    periodEnd: billing.periodEnd?.toISOString() ?? null,
    periodStart: billing.periodStart?.toISOString() ?? null,
    planName: billing.planName,
    state: billing.state,
    usage,
  };
}

async function loadPendingInvitations(
  canManage: boolean,
  clerkOrganizationId: string | null,
): Promise<WorkspaceSettingsData["pendingInvitations"]> {
  // Only managers see invitations, and only a real Clerk workspace has any
  // (clerkOrganizationId is null in mock mode).
  if (!canManage || !clerkOrganizationId) {
    return [];
  }
  try {
    const invitations =
      await clerkOrganizationDirectory.listPendingInvitations(
        clerkOrganizationId,
      );
    return invitations.map((invitation) => ({
      email: invitation.email,
      id: invitation.id,
      role: invitation.role,
    }));
  } catch (error) {
    console.error("[settings] failed to load pending invitations", error);
    return [];
  }
}

export function parseOrganizationSettings(input: Prisma.JsonValue): {
  interview: SettingsInterviewPreferences;
  notifications: SettingsNotificationPreferences;
} {
  const root = isRecord(input) ? input : {};
  const interview = isRecord(root.interview) ? root.interview : {};

  return {
    interview: {
      allowAudio: readBoolean(
        interview.allowAudio,
        defaultInterviewPreferences.allowAudio,
      ),
      allowForm: readBoolean(
        interview.allowForm,
        defaultInterviewPreferences.allowForm,
      ),
      autoGenerateTranscript: readBoolean(
        interview.autoGenerateTranscript,
        defaultInterviewPreferences.autoGenerateTranscript,
      ),
      defaultLanguage: coerceConsoleLocale(
        typeof interview.defaultLanguage === "string"
          ? interview.defaultLanguage
          : defaultInterviewPreferences.defaultLanguage,
      ),
      interviewerVoice:
        typeof interview.interviewerVoice === "string"
          ? interview.interviewerVoice
          : defaultInterviewPreferences.interviewerVoice,
      requireRecordingConsent: readBoolean(
        interview.requireRecordingConsent,
        defaultInterviewPreferences.requireRecordingConsent,
      ),
      showReviewGuardrail: readBoolean(
        interview.showReviewGuardrail,
        defaultInterviewPreferences.showReviewGuardrail,
      ),
    },
    notifications: readWorkspaceNotificationPreferences(input),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
