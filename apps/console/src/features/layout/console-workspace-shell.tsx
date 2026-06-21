"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { EnterpriseShell } from "@prelude/ui";
import type { OrganizationUserContext } from "@prelude/types";

const sidebarStorageKey = "prelude:workspace-sidebar-collapsed";
const focusModePaths = ["/roles/new", "/interviews/new"];

export function ConsoleWorkspaceShell({
  account,
  accountActions,
  children,
}: {
  account: OrganizationUserContext;
  accountActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const isFocusMode = focusModePaths.some((path) => pathname?.startsWith(path));

  React.useEffect(() => {
    setIsCollapsed(window.localStorage.getItem(sidebarStorageKey) === "true");
  }, []);

  const handleCollapsedChange = React.useCallback((nextCollapsed: boolean) => {
    setIsCollapsed(nextCollapsed);
    window.localStorage.setItem(sidebarStorageKey, String(nextCollapsed));
  }, []);

  if (isFocusMode) {
    return (
      <div className="min-h-screen bg-[#F9F8F3] text-ink-900">
        {children}
      </div>
    );
  }

  return (
    <EnterpriseShell
      account={account}
      accountActions={accountActions}
      activePath={pathname}
      collapsed={isCollapsed}
      onCollapsedChange={handleCollapsedChange}
    >
      {children}
    </EnterpriseShell>
  );
}
