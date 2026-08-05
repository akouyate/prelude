"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Xmark } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { EnterpriseShell, type EnterpriseNavCounts } from "@prelude/ui";
import type { OrganizationUserContext } from "@prelude/types";

const sidebarStorageKey = "prelude:workspace-sidebar-collapsed";
// Focus-mode routes hide the workspace chrome, so each one declares where its
// exit affordance leads — without it the browser back button is the only way out.
const focusModeRoutes = [
  { exitHref: "/roles", path: "/roles/new" },
  { exitHref: "/roles", path: "/interviews/new" },
];

export function ConsoleWorkspaceShell({
  account,
  accountActions,
  children,
  navCounts,
}: {
  account: OrganizationUserContext;
  accountActions?: React.ReactNode;
  children: React.ReactNode;
  navCounts?: EnterpriseNavCounts;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const focusModeRoute = focusModeRoutes.find((route) =>
    pathname?.startsWith(route.path),
  );

  React.useEffect(() => {
    setIsCollapsed(window.localStorage.getItem(sidebarStorageKey) === "true");
  }, []);

  const handleCollapsedChange = React.useCallback((nextCollapsed: boolean) => {
    setIsCollapsed(nextCollapsed);
    window.localStorage.setItem(sidebarStorageKey, String(nextCollapsed));
  }, []);

  if (focusModeRoute) {
    return (
      <div className="min-h-screen bg-[#F9F8F3] text-ink-900">
        <Link
          className="fixed right-5 top-5 z-40 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-ink-200 bg-white/82 px-4 text-sm font-medium text-ink-900 backdrop-blur transition hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 sm:right-8"
          href={focusModeRoute.exitHref}
        >
          <Xmark aria-hidden={true} className="h-4 w-4" />
          {t("roleIntake.exit")}
        </Link>
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
      navCounts={navCounts}
      onCollapsedChange={handleCollapsedChange}
    >
      {children}
    </EnterpriseShell>
  );
}
