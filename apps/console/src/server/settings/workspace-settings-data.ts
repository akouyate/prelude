import "server-only";

import { prisma, type Prisma } from "@prelude/db";
import { readWorkspaceNotificationPreferences } from "@prelude/notifications/preferences";

import { canManageTeam } from "../../domain/organization-permissions";
import { getConsoleAuthIdentity } from "../auth/console-auth-provider";
import { clerkOrganizationDirectory } from "../organizations/clerk-organization-directory";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import type {
  SettingsInterviewPreferences,
  SettingsNotificationPreferences,
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
