import type { ReactNode } from "react";

import { ConsoleWorkspaceShell } from "../../src/features/layout/console-workspace-shell";
import { I18nProvider } from "../../src/providers/i18n-provider";
import { getConsoleAuthContext } from "../../src/server/auth/console-auth";
import { getWorkspaceNavCounts } from "../../src/server/dashboard/workspace-nav-counts";
import { requireCompletedOrganizationOnboarding } from "../../src/server/onboarding/onboarding-guard";
import { getAuthenticatedUserLocale } from "../../src/server/users/user-locale";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireCompletedOrganizationOnboarding();
  const [account, preferredLanguage, navCounts] = await Promise.all([
    getConsoleAuthContext(),
    getAuthenticatedUserLocale(),
    getWorkspaceNavCounts(),
  ]);

  return (
    <I18nProvider preferredLanguage={preferredLanguage}>
      <ConsoleWorkspaceShell account={account} navCounts={navCounts}>
        {children}
      </ConsoleWorkspaceShell>
    </I18nProvider>
  );
}
