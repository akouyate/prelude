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
  billing: {
    canManageBilling: boolean;
    manageBillingUnavailableReason:
      | "local_mock"
      | "not_configured"
      | "not_owner"
      | null;
    entitlements: {
      recording: boolean;
    };
    limits: {
      candidateInterviews: number | null;
      publishedRoles: number | null;
    };
    periodEnd: string | null;
    periodStart: string | null;
    planName: string;
    state:
      | "active"
      | "canceled"
      | "free"
      | "past_due"
      | "trialing"
      | "unavailable"
      | "unconfigured";
    usage: {
      candidateInterviews: number;
      publishedRoles: number;
    };
  };
  // Prepaid interview credits (#140). `null` whenever the credit kill switch is
  // off OR Stripe is unconfigured: the whole buy surface then never renders, so
  // the console cannot show a price it has no way to charge.
  creditBilling: WorkspaceCreditBilling | null;
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

/**
 * Amendment 15: never a bare number. A recruiter deciding whether to buy needs
 * to know how much of the balance they actually PAID for (the First Five are a
 * one-off, not a renewable allowance) and what is about to expire — so the split
 * and the next expiry are part of the contract, not a UI afterthought.
 *
 * Dates cross the server/client boundary as ISO strings, like every other date
 * on this type.
 */
export type WorkspaceCreditBilling = {
  paidAvailable: number;
  freeAvailable: number;
  nextExpiry: { credits: number; expiresAt: string } | null;
  packs: WorkspaceCreditPack[];
  // Amendment 20: the `quiet` pack is never listed but stays purchasable, so the
  // "need more than 500 interviews?" line gets its id here rather than hardcoding
  // a catalogue slug in a component. `null` when nothing quiet is on sale.
  volumePackId: string | null;
};

export type WorkspaceCreditPack = {
  id: string;
  creditsGranted: number;
  // Display cache only — Stripe Checkout remains the authority on what is charged
  // (amendment 22: it picks the buyer's currency from their location).
  unitAmountCents: number;
  unitAmountCentsUsd: number | null;
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
