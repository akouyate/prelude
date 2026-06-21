import type { ReactNode } from "react";

import { ConsoleWorkspaceShell } from "../../src/features/layout/console-workspace-shell";
import { getConsoleAuthContext } from "../../src/server/auth/console-auth";
import { requireCompletedOrganizationOnboarding } from "../../src/server/onboarding/onboarding-guard";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireCompletedOrganizationOnboarding();
  const account = await getConsoleAuthContext();

  return (
    <ConsoleWorkspaceShell account={account}>{children}</ConsoleWorkspaceShell>
  );
}
