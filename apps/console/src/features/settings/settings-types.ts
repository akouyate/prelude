export type SettingsSection =
  | "billing"
  | "integrations"
  | "interview"
  | "notifications"
  | "profile"
  | "team"
  | "workspace";

export type WorkspaceSettingsData = {
  account: {
    email: string;
    name: string;
    role: string;
    preferredLanguage: "en" | "fr";
  };
  authProvider: "clerk" | "mock";
  connectedAccounts: SettingsConnectedAccount[];
  connectors: Array<{
    provider: string;
    status: string;
  }>;
  integrationAvailability: {
    googleOAuth: boolean;
  };
  interviewPreferences: SettingsInterviewPreferences;
  metrics: {
    activeRoles: number;
    drafts: number;
    needsReview: number;
    published: number;
  };
  notificationPreferences: SettingsNotificationPreferences;
  organization: {
    companySize: string | null;
    defaultInterviewMode: string | null;
    hiringFocus: string | null;
    name: string;
  };
  team: Array<{
    clerkUserId: string;
    email: string;
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
  // Whether the current viewer may invite/manage teammates (owner or admin).
  canManageTeam: boolean;
  // The viewer's own Clerk user id, so the UI can hide self-directed actions.
  viewerClerkUserId: string;
  pendingInvitations: Array<{
    email: string;
    id: string;
    role: string;
  }>;
};

export type SettingsConnectedAccountStatus =
  | "connected"
  | "connecting"
  | "error"
  | "expired"
  | "needs_reconnect"
  | "not_connected"
  | "revoked";

export type SettingsConnectedAccount = {
  capabilities: string[];
  connectedAt: string | null;
  disconnectedAt: string | null;
  externalAccountEmail: string | null;
  externalAccountId: string | null;
  provider: "google";
  scopes: string[];
  status: SettingsConnectedAccountStatus;
};

export type SettingsInterviewPreferences = {
  allowAudio: boolean;
  allowForm: boolean;
  autoGenerateTranscript: boolean;
  defaultLanguage: "en" | "fr";
  interviewerVoice: string;
  requireRecordingConsent: boolean;
  showReviewGuardrail: boolean;
};

export type SettingsNotificationPreferences = WorkspaceNotificationPreferences;
import type { WorkspaceNotificationPreferences } from "@prelude/notifications/preferences";
