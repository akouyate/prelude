import "server-only";

import { prisma, type Prisma } from "@prelude/db";

import { getConsoleAuthIdentity } from "../auth/console-auth-provider";
import { getCompletedOrganizationScope } from "../organizations/organization-scope";
import type {
  SettingsInterviewPreferences,
  SettingsNotificationPreferences,
  WorkspaceSettingsData,
} from "../../features/settings/settings-types";
import { coerceConsoleLocale } from "../../libs/i18n-server";

const defaultInterviewPreferences: SettingsInterviewPreferences = {
  allowAudio: true,
  allowForm: true,
  autoGenerateTranscript: true,
  defaultLanguage: "en",
  interviewerVoice: "maya",
  requireRecordingConsent: true,
  showReviewGuardrail: true,
};

const defaultNotificationPreferences: SettingsNotificationPreferences = {
  interviewCompleted: true,
  mentionsAndComments: true,
  productUpdates: false,
  screensReadyForReview: true,
  weeklyDigest: false,
};

export async function getWorkspaceSettingsData(): Promise<WorkspaceSettingsData> {
  const [identity, scope] = await Promise.all([
    getConsoleAuthIdentity(),
    getCompletedOrganizationScope(),
  ]);

  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const [organization, draftCount, publishedCount, activeRoleCount, user] = await Promise.all([
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
    prisma.user.findUnique({
      select: { preferredLanguage: true },
      where: { id: scope.userId },
    }),
  ]);

  const preferences = parseOrganizationSettings(organization.settings);

  return {
    account: {
      email: identity.value.userEmail,
      name: identity.value.userName,
      preferredLanguage: coerceConsoleLocale(user?.preferredLanguage),
      role: scope.role,
    },
    authProvider: identity.value.source,
    connectors: organization.jobSourceConnections.map((connector) => ({
      provider: connector.provider,
      status: connector.status,
    })),
    interviewPreferences: preferences.interview,
    metrics: {
      activeRoles: activeRoleCount,
      needsReview: await prisma.candidateSession.count({
        where: {
          organizationId: scope.organizationId,
          reviewStatus: "to_review",
          status: "completed",
        },
      }),
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
      email: membership.user.email,
      id: membership.id,
      name: membership.user.name ?? membership.user.email,
      role: membership.role,
      status: membership.status,
    })),
  };
}

export function parseOrganizationSettings(input: Prisma.JsonValue): {
  interview: SettingsInterviewPreferences;
  notifications: SettingsNotificationPreferences;
} {
  const root = isRecord(input) ? input : {};
  const interview = isRecord(root.interview) ? root.interview : {};
  const notifications = isRecord(root.notifications) ? root.notifications : {};

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
    notifications: {
      interviewCompleted: readBoolean(
        notifications.interviewCompleted,
        defaultNotificationPreferences.interviewCompleted,
      ),
      mentionsAndComments: readBoolean(
        notifications.mentionsAndComments,
        defaultNotificationPreferences.mentionsAndComments,
      ),
      productUpdates: readBoolean(
        notifications.productUpdates,
        defaultNotificationPreferences.productUpdates,
      ),
      screensReadyForReview: readBoolean(
        notifications.screensReadyForReview,
        defaultNotificationPreferences.screensReadyForReview,
      ),
      weeklyDigest: readBoolean(
        notifications.weeklyDigest,
        defaultNotificationPreferences.weeklyDigest,
      ),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}
