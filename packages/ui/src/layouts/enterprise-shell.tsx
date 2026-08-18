import * as React from "react";
import { NavArrowDown } from "iconoir-react";

import { BrandMark } from "../components/brand-mark";
import { cn } from "../lib/cn";

// The nav glyphs are inlined rather than pulled from iconoir so the sidebar
// matches the console design system stroke-for-stroke.
function NavGlyph({
  className,
  path,
}: {
  className?: string;
  path: React.ReactNode;
}) {
  return (
    <svg
      aria-hidden={true}
      className={cn("h-[18px] w-[18px] shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      {path}
    </svg>
  );
}

const navGlyphs = {
  candidates: (
    <>
      <circle cx="9.6" cy="8.1" r="3.6" />
      <path d="M3.4 19.6c0-3.42 2.78-5.9 6.2-5.9s6.2 2.48 6.2 5.9" />
      <path d="M16.4 5.3a3.4 3.4 0 0 1 0 5.6" />
      <path d="M18.2 19.6c0-1.95-.42-3.5-1.2-4.66" />
    </>
  ),
  dashboard: (
    <>
      <rect height="18" rx="4.5" width="18" x="3" y="3" />
      <path d="M3 9.5h18" />
      <path d="M9.75 21V9.5" />
    </>
  ),
  roles: (
    <>
      <rect height="13.5" rx="3.5" width="19" x="2.5" y="6.75" />
      <path d="M9 6.75V5.6A2.1 2.1 0 0 1 11.1 3.5h1.8A2.1 2.1 0 0 1 15 5.6v1.15" />
      <path d="M2.5 12.4h19" />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 7.4h8.2" />
      <path d="M17 7.4h3.5" />
      <path d="M3.5 16.6h3.2" />
      <path d="M12 16.6h8.5" />
      <circle cx="14.3" cy="7.4" r="2.35" />
      <circle cx="9.3" cy="16.6" r="2.35" />
    </>
  ),
} as const;

type NavKey = keyof typeof navGlyphs;

type ShellNavItem = {
  badgeTone?: "neutral" | "olive";
  count?: number;
  href: string;
  key: NavKey;
  label: string;
  matchHref?: string;
};

export type EnterpriseNavCounts = {
  candidates?: number;
  roles?: number;
};

// Populated by `getWorkspaceCreditSummary` (apps/console) from the prepaid
// wallet. `nextExpiryLabel` arrives pre-formatted so this package stays free
// of a date library, same reasoning as passing counts instead of raw records.
export type EnterpriseNavCredits = {
  available: number;
  low: boolean;
  nextExpiryLabel: string | null;
  topUpHref: string;
  totalGranted: number;
};

const settingsNavItem: ShellNavItem = {
  href: "/settings",
  key: "settings",
  label: "Settings",
};

type ShellNavGroup = {
  items: ShellNavItem[];
  label: string;
};

function buildNavGroups(counts: EnterpriseNavCounts): ShellNavGroup[] {
  return [
    {
      items: [{ href: "/", key: "dashboard", label: "Dashboard" }],
      label: "Overview",
    },
    {
      items: [
        {
          badgeTone: "neutral",
          count: counts.roles,
          href: "/roles",
          key: "roles",
          label: "Roles",
        },
        {
          badgeTone: "olive",
          count: counts.candidates,
          href: "/candidates",
          key: "candidates",
          label: "Candidates",
        },
      ],
      label: "Hiring",
    },
  ];
}

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
  credits?: EnterpriseNavCredits | null;
  navCounts?: EnterpriseNavCounts;
  onCollapsedChange?: (collapsed: boolean) => void;
};

export function EnterpriseShell({
  account,
  accountActions,
  activePath = "/",
  children,
  className,
  collapsed = false,
  credits,
  navCounts = {},
  onCollapsedChange,
}: EnterpriseShellProps) {
  const organizationName = account?.organizationName ?? "Recruiter console";
  const userName = account?.userName ?? "HireCall user";

  return (
    <div className={cn("min-h-screen bg-[#F9F8F3] text-ink-900", className)}>
      <div className="min-h-screen w-full">
        <EnterpriseSidebar
          accountActions={accountActions}
          activePath={activePath}
          collapsed={collapsed}
          credits={credits}
          navCounts={navCounts}
          onCollapsedChange={onCollapsedChange}
          organizationName={organizationName}
          userName={userName}
        />
        <div
          className={cn(
            "min-w-0 transition-[padding] duration-200 max-[900px]:pb-[calc(78px+env(safe-area-inset-bottom))] min-[901px]:pl-[250px]",
            collapsed && "min-[901px]:pl-[68px]",
          )}
        >
          <MobileWorkspaceHeader credits={credits} organizationName={organizationName} />
          {/*
           * The gutter is a literal, not a custom property. It was briefly
           * published as `--shell-gutter` so a scroller inside a page could
           * cancel it and run edge to edge — but a padding that resolves
           * through a variable fails to ZERO when the rule defining it is
           * missing from the served CSS (a stale stylesheet in a phone's
           * cache is enough), and the whole page then sits flush against both
           * edges with no margin at all. Reported from a real iPhone,
           * reproduced by unsetting the property: padding-left went to 0px
           * while the header kept its own literal padding. A cosmetic bleed is
           * not worth a layout that can lose its margins.
           */}
          <main className="px-[clamp(16px,3vw,40px)] py-[clamp(20px,3vw,38px)] pb-16">
            <div className="mx-auto w-full max-w-[1180px]">{children}</div>
          </main>
          <MobileWorkspaceNav activePath={activePath} />
        </div>
      </div>
    </div>
  );
}

function MobileWorkspaceHeader({
  credits,
  organizationName,
}: {
  credits?: EnterpriseNavCredits | null;
  organizationName: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[#e7e2d8] bg-[#faf8f3]/97 px-4 py-[11px] backdrop-blur-[14px] min-[901px]:hidden">
      <BrandMark appearance="color" labelClassName="h-[26px] max-w-none" />
      {credits ? (
        <MobileCreditPill credits={credits} />
      ) : (
        <span className="max-w-[9rem] truncate text-right text-xs font-medium text-[#8a8178]">
          {organizationName}
        </span>
      )}
    </header>
  );
}

function MobileCreditPill({ credits }: { credits: EnterpriseNavCredits }) {
  return (
    <a
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-3 py-1.5 font-title text-[12px] font-semibold text-ink-900",
        credits.low && "border-[#eccfc2] bg-[#fffaf7] text-[#a3421f]",
        !credits.low && "border-[#e7e2d8]",
      )}
      href={credits.topUpHref}
      title={creditMeterTitle(credits)}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          credits.low ? "bg-[#c2542f]" : "bg-olive-700",
        )}
      />
      {credits.available}
      <span className="font-medium text-[#8a8178]">credits</span>
    </a>
  );
}

function MobileWorkspaceNav({ activePath }: { activePath: string }) {
  const items = [
    ...buildNavGroups({}).flatMap((group) => group.items),
    settingsNavItem,
  ];

  return (
    <nav
      aria-label="Workspace"
      className="fixed inset-x-0 bottom-0 z-[55] flex items-stretch gap-1 border-t border-[#e7e2d8] bg-[#faf8f3]/97 px-2 pb-[calc(6px+env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-[14px] min-[901px]:hidden"
    >
      {items.map((item) => {
        const active = isActivePath(activePath, item.matchHref ?? item.href);

        return (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[50px] flex-1 flex-col items-center justify-center gap-1 rounded-[14px] border font-title text-[10.5px] font-semibold tracking-[-0.005em]",
              active
                ? "border-[#e7e2d8] bg-white text-ink-900"
                : "border-transparent text-[#8a8178]",
            )}
            href={item.href}
            key={item.key}
          >
            <NavGlyph className="h-[19px] w-[19px]" path={navGlyphs[item.key]} />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function EnterpriseSidebar({
  accountActions,
  activePath,
  collapsed,
  credits,
  navCounts,
  onCollapsedChange,
  organizationName,
  userName,
}: {
  accountActions?: React.ReactNode;
  activePath: string;
  collapsed: boolean;
  credits?: EnterpriseNavCredits | null;
  navCounts: EnterpriseNavCounts;
  onCollapsedChange?: (collapsed: boolean) => void;
  organizationName: string;
  userName: string;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-[#e7e2d8] bg-[#faf8f3] pb-3.5 pt-4 transition-[width,padding] duration-200 min-[901px]:flex",
        collapsed ? "w-[68px] px-2.5" : "w-[250px] px-3",
      )}
    >
      <div
        className={cn(
          "flex h-[34px] items-center gap-2.5 px-0.5",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <BrandMark
          appearance="color"
          compact={collapsed}
          labelClassName="h-[26px] max-w-none"
          markClassName="h-[26px] w-[26px]"
        />
        {onCollapsedChange && !collapsed ? (
          <button
            aria-label="Collapse sidebar"
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-ink-900/5 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={() => onCollapsedChange(true)}
            title="Collapse sidebar"
            type="button"
          >
            <ChevronPair direction="left" />
          </button>
        ) : null}
      </div>

      {collapsed && onCollapsedChange ? (
        <button
          aria-label="Expand sidebar"
          className="mt-3.5 grid h-[34px] w-full place-items-center rounded-full border border-[#e7e2d8] bg-white text-ink-400 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={() => onCollapsedChange(false)}
          title="Expand sidebar"
          type="button"
        >
          <ChevronPair direction="right" />
        </button>
      ) : null}

      {buildNavGroups(navCounts).map((group, index) => (
        <div className={index === 0 ? "mt-[22px]" : "mt-5"} key={group.label}>
          <p
            className={cn(
              "mb-1.5 px-[13px] font-title text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400",
              collapsed && "hidden",
            )}
          >
            {group.label}
          </p>
          <nav aria-label={group.label} className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <SidebarNavItem
                active={isActivePath(activePath, item.matchHref ?? item.href)}
                collapsed={collapsed}
                item={item}
                key={item.key}
              />
            ))}
          </nav>
        </div>
      ))}

      <div className="mt-auto flex flex-col gap-0.5 border-t border-[#f0ece1] pt-2.5">
        {credits ? <CreditMeter collapsed={collapsed} credits={credits} /> : null}
        <SidebarNavItem
          active={isActivePath(activePath, settingsNavItem.href)}
          collapsed={collapsed}
          item={settingsNavItem}
        />
        <a
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-full px-2.5 transition hover:bg-ink-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
            collapsed && "justify-center px-0",
          )}
          href="/settings"
          title={userName}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef0e3] font-title text-[11.5px] font-semibold text-olive-900">
            {initialsFor(userName)}
          </span>
          <span
            className={cn("flex min-w-0 flex-1 flex-col", collapsed && "hidden")}
          >
            <span className="truncate font-title text-[13px] font-semibold text-ink-900">
              {userName}
            </span>
            <span className="truncate text-[11px] text-ink-400">
              {organizationName}
            </span>
          </span>
          <NavArrowDown
            aria-hidden={true}
            className={cn(
              "h-[13px] w-[13px] shrink-0 text-[#bdb6a8]",
              collapsed && "hidden",
            )}
          />
        </a>
        {accountActions ? (
          <div className={cn("mt-1 flex justify-end px-2", collapsed && "px-0")}>
            {accountActions}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// The prepaid wallet, above Settings in the bottom section. `credits.available`
// already excludes held reservations (it comes straight from
// `computeWalletTotals` in @prelude/core), so the "used" fraction below is
// exactly `totalGranted - available` — a reservation shows as used without
// this component knowing reservations exist.
function CreditMeter({
  collapsed,
  credits,
}: {
  collapsed: boolean;
  credits: EnterpriseNavCredits;
}) {
  const usedFraction =
    credits.totalGranted > 0
      ? Math.min(
          1,
          Math.max(0, (credits.totalGranted - credits.available) / credits.totalGranted),
        )
      : 0;

  if (collapsed) {
    return (
      <a
        className={cn(
          "mb-2 flex flex-col items-center gap-1 rounded-[14px] border bg-white px-2 py-2 transition hover:bg-ink-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
          credits.low && "border-[#eccfc2] bg-[#fffaf7]",
          !credits.low && "border-[#e7e2d8]",
        )}
        href={credits.topUpHref}
        title={creditMeterTitle(credits)}
      >
        <span
          className={cn(
            "font-title text-[12.5px] font-semibold",
            credits.low ? "text-[#a3421f]" : "text-ink-900",
          )}
        >
          {credits.available}
        </span>
        <span
          className={cn(
            "h-1 w-[26px] overflow-hidden rounded-full",
            credits.low ? "bg-[#f7e4dc]" : "bg-[#eceada]",
          )}
        >
          <span
            className={cn(
              "block h-full rounded-full",
              credits.low ? "bg-[#c2542f]" : "bg-olive-800",
            )}
            style={{ width: `${usedFraction * 100}%` }}
          />
        </span>
      </a>
    );
  }

  return (
    <a
      className={cn(
        "mb-2.5 flex flex-col gap-2 rounded-2xl border px-3 py-2.5 transition hover:bg-ink-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
        credits.low && "border-[#eccfc2] bg-[#fffaf7]",
        !credits.low && "border-[#e7e2d8] bg-white",
      )}
      href={credits.topUpHref}
    >
      <div className="flex items-center justify-between">
        <span className="font-title text-[10px] font-semibold uppercase tracking-[0.1em] text-[#a29b8d]">
          Credits
        </span>
        <span
          className={cn(
            "font-title text-[11px] font-semibold",
            credits.low ? "text-[#a3421f]" : "text-olive-900",
          )}
        >
          Top up
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-title text-[21px] font-semibold tracking-[-0.02em]",
            credits.low ? "text-[#a3421f]" : "text-[#171715]",
          )}
        >
          {credits.available}
        </span>
        {credits.totalGranted > 0 ? (
          <span className="text-[11.5px] text-[#8a8178]">
            left of {credits.totalGranted}
          </span>
        ) : null}
      </div>
      <span
        className={cn(
          "block h-[5px] overflow-hidden rounded-full",
          credits.low ? "bg-[#f7e4dc]" : "bg-[#eceada]",
        )}
      >
        <span
          className={cn(
            "block h-full rounded-full",
            credits.low ? "bg-[#c2542f]" : "bg-olive-800",
          )}
          style={{ width: `${usedFraction * 100}%` }}
        />
      </span>
      {credits.nextExpiryLabel ? (
        <span className="text-[10.5px] text-[#a29b8d]">
          {credits.nextExpiryLabel}
        </span>
      ) : null}
    </a>
  );
}

function creditMeterTitle(credits: EnterpriseNavCredits): string {
  const base =
    credits.totalGranted > 0
      ? `${credits.available} credits available, left of ${credits.totalGranted}`
      : `${credits.available} credits available`;

  return credits.nextExpiryLabel ? `${base}. ${credits.nextExpiryLabel}.` : `${base}.`;
}

function ChevronPair({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden={true}
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.9}
      viewBox="0 0 24 24"
    >
      {direction === "left" ? (
        <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
      ) : (
        <path d="M13 6l6 6-6 6M5 6l6 6-6 6" />
      )}
    </svg>
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
        "flex h-[34px] items-center gap-2.5 rounded-full border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
        collapsed && "justify-center px-0",
        active
          ? "border-[#e7e2d8] bg-white text-ink-900"
          : "border-transparent text-ink-700 hover:bg-ink-900/5 hover:text-ink-900",
      )}
      href={item.href}
      title={item.label}
    >
      <NavGlyph path={navGlyphs[item.key]} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-title text-[15px] tracking-[-0.005em]",
          active ? "font-semibold" : "font-medium",
          collapsed && "hidden",
        )}
      >
        {item.label}
      </span>
      {item.count && item.count > 0 && !collapsed ? (
        <span
          className={cn(
            "flex h-[19px] min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 font-title text-[11px] font-semibold",
            item.badgeTone === "olive"
              ? "bg-[#eef0e3] text-olive-900"
              : "bg-[#f1efe8] text-[#6f6a5f]",
          )}
        >
          {item.count}
        </span>
      ) : null}
    </a>
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
