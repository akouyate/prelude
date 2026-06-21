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
  };
  connectors: Array<{
    provider: string;
    status: string;
  }>;
  metrics: {
    activeRoles: number;
    needsReview: number;
    published: number;
  };
  organization: {
    companySize: string | null;
    defaultInterviewMode: string | null;
    hiringFocus: string | null;
    name: string;
  };
};
