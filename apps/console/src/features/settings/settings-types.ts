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
  connectors: Array<{
    provider: string;
    status: string;
  }>;
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
    email: string;
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
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

export type SettingsNotificationPreferences = {
  interviewCompleted: boolean;
  mentionsAndComments: boolean;
  productUpdates: boolean;
  screensReadyForReview: boolean;
  weeklyDigest: boolean;
};
