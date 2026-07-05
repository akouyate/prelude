import * as React from "react";
import {
  Community,
  NavArrowLeft,
  NavArrowRight,
  NavArrowDown,
  Settings,
  Suitcase,
  ViewGrid,
} from "iconoir-react";

import { BrandMark } from "../components/brand-mark";
import { IconButton } from "../components/icon-button";
import { cn } from "../lib/cn";

type ShellNavItem = {
  badge?: string;
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  matchHref?: string;
};

const primaryNavItems: ShellNavItem[] = [
  { label: "Dashboard", href: "/", icon: ViewGrid },
  { label: "Roles", href: "/roles", icon: Suitcase },
  { label: "Candidates", href: "/candidates", icon: Community },
];

const secondaryNavItems: ShellNavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
];

type EnterpriseAccount = {
  organizationName: string;
  userEmail: string;
  userName: string;
  role: string;
};

export type EnterpriseShellProps = {
  account?: EnterpriseAccount;
  accountActions?: React.ReactNode;
  activePath?: string;
  children: React.ReactNode;
  className?: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function EnterpriseShell({
  account,
  accountActions,
  activePath = "/",
  children,
  className,
  collapsed = false,
  onCollapsedChange,
}: EnterpriseShellProps) {
  const organizationName = account?.organizationName ?? "Recruiter console";
  const userName = account?.userName ?? "Prelude user";
  const userEmail = account?.userEmail ?? "workspace";

  return (
    <div
      className={cn(
        "min-h-screen bg-[#F9F8F3] text-ink-900",
        className,
      )}
    >
      <div className="min-h-screen w-full">
        <EnterpriseSidebar
          account={account}
          accountActions={accountActions}
          activePath={activePath}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          organizationName={organizationName}
          userEmail={userEmail}
          userName={userName}
        />
        <div
          className={cn(
            "min-w-0 transition-[padding] duration-200 lg:pl-64",
            collapsed && "lg:pl-[74px]",
          )}
        >
          <MobileWorkspaceHeader
            activePath={activePath}
            organizationName={organizationName}
          />
          <main className="px-[clamp(16px,3vw,40px)] py-[clamp(20px,3vw,38px)] pb-16">
            <div className="mx-auto w-full max-w-[1180px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function MobileWorkspaceHeader({
  activePath,
  organizationName,
}: {
  activePath: string;
  organizationName: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-100 bg-[#fbfaf7]/86 px-4 py-3 backdrop-blur-xl lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <BrandMark />
        <div className="flex items-center gap-2">
          <span className="hidden max-w-[9rem] truncate text-right text-xs font-medium text-ink-500 sm:block">
            {organizationName}
          </span>
        </div>
      </div>
      <nav
        aria-label="Workspace"
        className="mt-3 flex gap-1 overflow-x-auto pb-1"
      >
        {primaryNavItems.slice(0, 3).map((item) => (
          <a
            aria-current={
              isActivePath(activePath, item.matchHref ?? item.href)
                ? "page"
                : undefined
            }
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors",
              isActivePath(activePath, item.matchHref ?? item.href)
                ? "bg-[#eef0e3] text-olive-900"
                : "text-ink-600 hover:bg-white/70 hover:text-ink-950",
            )}
            href={item.href}
            key={item.label}
          >
            <item.icon aria-hidden={true} className="h-4 w-4" />
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

function EnterpriseSidebar({
  account,
  accountActions,
  activePath,
  collapsed,
  onCollapsedChange,
  organizationName,
  userEmail,
  userName,
}: {
  account?: EnterpriseAccount;
  accountActions?: React.ReactNode;
  activePath: string;
  collapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  organizationName: string;
  userEmail: string;
  userName: string;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-ink-100 bg-[#fbfaf7]/76 backdrop-blur-xl transition-[width,padding] duration-200 lg:flex",
        collapsed ? "w-[74px] px-3 py-[18px]" : "w-64 px-4 py-[18px]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-1",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <BrandMark
          compact={collapsed}
          labelClassName="font-title text-[15px]"
          markClassName="h-[30px] w-[30px]"
        />
        {onCollapsedChange && !collapsed ? (
          <SidebarToggleButton
            collapsed={collapsed}
            onCollapsedChange={onCollapsedChange}
          />
        ) : null}
      </div>

      {collapsed && onCollapsedChange ? (
        <SidebarToggleButton
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
        />
      ) : null}

      <WorkspaceSwitcher
        collapsed={collapsed}
        organizationName={organizationName}
      />

      <nav aria-label="Workspace" className="mt-5 flex flex-col gap-1">
        {primaryNavItems.map((item) => (
          <SidebarNavItem
            active={isActivePath(activePath, item.matchHref ?? item.href)}
            collapsed={collapsed}
            item={item}
            key={item.label}
          />
        ))}
      </nav>

      <div className="mt-auto border-t border-ink-100 pt-4">
        <nav aria-label="Account" className="flex flex-col gap-1">
          {secondaryNavItems.map((item) => (
            <SidebarNavItem
              active={isActivePath(activePath, item.matchHref ?? item.href)}
              collapsed={collapsed}
              item={item}
              key={item.label}
            />
          ))}
        </nav>
        <AccountSummary
          account={account}
          collapsed={collapsed}
          userEmail={userEmail}
          userName={userName}
        />
        {accountActions ? (
          <div className="mt-2 flex justify-end px-2">{accountActions}</div>
        ) : null}
      </div>
    </aside>
  );
}

function SidebarToggleButton({
  collapsed,
  onCollapsedChange,
}: {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const Icon = collapsed ? NavArrowRight : NavArrowLeft;

  return (
    <IconButton
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        collapsed
          ? "mt-[18px] h-9 w-full rounded-[11px] border-ink-100 bg-white/60 hover:border-ink-200 hover:bg-white/80"
          : "h-7 w-7 rounded-lg",
      )}
      onClick={() => onCollapsedChange(!collapsed)}
      size="sm"
      variant={collapsed ? "secondary" : "ghost"}
    >
      <Icon aria-hidden={true} className="h-[17px] w-[17px]" />
    </IconButton>
  );
}

function WorkspaceSwitcher({
  collapsed,
  organizationName,
}: {
  collapsed: boolean;
  organizationName: string;
}) {
  return (
    <div
      className={cn(
        "mt-[18px] flex h-12 items-center gap-2.5 rounded-[14px] border border-ink-100 bg-white/62 px-[11px] text-left transition hover:border-ink-200 hover:bg-white",
        collapsed && "justify-center px-0",
      )}
      title={organizationName}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-olive-800 text-xs font-semibold text-white">
        {initialsFor(organizationName)}
      </span>
      <div className={cn("min-w-0 flex-1", collapsed && "hidden")}>
        <p className="truncate text-sm font-semibold text-ink-950">
          {organizationName}
        </p>
        <p className="text-xs text-ink-400">Pro workspace</p>
      </div>
      <NavArrowDown
        aria-hidden={true}
        className={cn("h-4 w-4 text-ink-400", collapsed && "hidden")}
      />
    </div>
  );
}

function SidebarNavItem({
  active,
  collapsed,
  item,
}: {
  active: boolean;
  collapsed: boolean;
  item: ShellNavItem;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={cn(
        "group inline-flex h-10 cursor-pointer items-center gap-[11px] rounded-[11px] px-[11px] text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
        collapsed && "justify-center px-0",
        active
          ? "border border-[#e2e6d3] bg-[#eef0e3] font-semibold text-olive-900"
          : "font-medium text-ink-600 hover:bg-white/68 hover:text-ink-950",
      )}
      href={item.href}
      title={collapsed ? item.label : undefined}
    >
      <item.icon aria-hidden={true} className="h-[18px] w-[18px] shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "hidden")}>
        {item.label}
      </span>
      {item.badge && !collapsed ? (
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
          {item.badge}
        </span>
      ) : null}
    </a>
  );
}

function AccountSummary({
  account,
  collapsed,
  userEmail,
  userName,
}: {
  account?: EnterpriseAccount;
  collapsed: boolean;
  userEmail: string;
  userName: string;
}) {
  return (
    <div className="mt-3">
      <a
        aria-label="Open workspace settings"
        className={cn(
          "flex h-[50px] cursor-pointer items-center gap-2.5 rounded-xl px-[11px] text-left transition hover:bg-white/68 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
          collapsed && "justify-center",
        )}
        href="/settings"
        title={collapsed ? userName : undefined}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-ink-100 bg-white/72 text-xs font-semibold text-olive-900">
          {initialsFor(userName)}
        </span>
        <div className={cn("min-w-0 flex-1", collapsed && "hidden")}>
          <p className="truncate text-sm font-semibold text-ink-950">
            {userName}
          </p>
        <p className="truncate text-xs text-ink-400">
            {account ? formatRole(account.role) : userEmail}
          </p>
        </div>
        <NavArrowRight
          aria-hidden={true}
          className={cn("h-4 w-4 text-ink-300", collapsed && "hidden")}
        />
      </a>
    </div>
  );
}

function isActivePath(activePath: string, href: string) {
  const path = href.split("#")[0] || "/";
  if (href === "/") {
    return activePath === "/";
  }

  if (path === "/") {
    return false;
  }

  return activePath === path || activePath.startsWith(`${path}/`);
}

function initialsFor(value: string) {
  const initials = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "P";
}

function formatRole(role: string) {
  return role.replace(/_/g, " ");
}
