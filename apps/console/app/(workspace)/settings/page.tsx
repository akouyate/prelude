import { WorkspaceSettings } from "../../../src/features/settings/workspace-settings";
import { getConsoleAuthContext } from "../../../src/server/auth/console-auth";
import { getConsoleDashboardData } from "../../../src/server/dashboard/dashboard-data";
import { getAuthenticatedUserLocale } from "../../../src/server/users/user-locale";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WorkspaceSettingsPage() {
  const [account, dashboard, preferredLanguage] = await Promise.all([
    getConsoleAuthContext(),
    getConsoleDashboardData(),
    getAuthenticatedUserLocale(),
  ]);

  return (
    <WorkspaceSettings
      data={{
        account: {
          email: account.userEmail,
          name: account.userName,
          role: account.role,
          preferredLanguage,
        },
        connectors: dashboard.connectors,
        metrics: {
          activeRoles: dashboard.metrics.activeRoles,
          needsReview: dashboard.metrics.needsReview,
          published: dashboard.metrics.published,
        },
        organization: {
          companySize: dashboard.organization.companySize,
          defaultInterviewMode: dashboard.organization.defaultInterviewMode,
          hiringFocus: dashboard.organization.hiringFocus,
          name: dashboard.organization.name,
        },
      }}
    />
  );
}
