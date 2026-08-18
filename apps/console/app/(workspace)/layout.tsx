import type { ReactNode } from "react";
import { ToastProvider } from "@prelude/ui";

import { ConsoleWorkspaceShell } from "../../src/features/layout/console-workspace-shell";
import { I18nProvider } from "../../src/providers/i18n-provider";
import { getConsoleAuthContext } from "../../src/server/auth/console-auth";
import { getWorkspaceCreditSummary } from "../../src/server/billing/workspace-credit-summary";
import { getWorkspaceNavCounts } from "../../src/server/dashboard/workspace-nav-counts";
import { requireCompletedOrganizationOnboarding } from "../../src/server/onboarding/onboarding-guard";
import { getAuthenticatedUserLocale } from "../../src/server/users/user-locale";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireCompletedOrganizationOnboarding();
  const [account, preferredLanguage, navCounts, credits] = await Promise.all([
    getConsoleAuthContext(),
    getAuthenticatedUserLocale(),
    getWorkspaceNavCounts(),
    getWorkspaceCreditSummary(),
  ]);

  return (
    <I18nProvider preferredLanguage={preferredLanguage}>
      {/* Split: transient announcements (e.g. purchase results) render as
          toasts via this provider; contextual/blocking errors (form
          validation, action failures) stay inline next to what they describe. */}
      <ToastProvider>
        <ConsoleWorkspaceShell account={account} credits={credits} navCounts={navCounts}>
          {children}
        </ConsoleWorkspaceShell>
      </ToastProvider>
    </I18nProvider>
  );
}
