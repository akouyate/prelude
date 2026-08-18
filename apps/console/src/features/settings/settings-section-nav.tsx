"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { useTranslation } from "react-i18next";
import { cn } from "@prelude/ui";

import type { SettingsSection } from "./settings-types";

/*
 * The settings sub-navigation is a sticky rail on the left of the pane, and a
 * horizontal scroller below 900px. Icons are drawn to the settings design spec
 * rather than pulled from iconoir: they are optically lighter than the console
 * glyphs, which is what lets the rail sit quietly next to the panes.
 */
type SettingsNavItem = {
  icon: React.ReactNode;
  labelKey: string;
  value: SettingsSection;
};

const settingsNavItems: SettingsNavItem[] = [
  {
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </>
    ),
    labelKey: "settings.nav.profile",
    value: "profile",
  },
  {
    icon: (
      <>
        <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
        <path d="M15 9h4a1 1 0 0 1 1 1v11" />
        <path d="M3 21h18" />
        <path d="M8 8h0M8 12h0M8 16h0" />
      </>
    ),
    labelKey: "settings.nav.workspace",
    value: "workspace",
  },
  {
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16 5.5a3.2 3.2 0 0 1 0 6" />
        <path d="M17 14.2A6 6 0 0 1 21 20" />
      </>
    ),
    labelKey: "settings.nav.team",
    value: "team",
  },
  {
    icon: (
      <>
        <rect height="13" rx="2" width="18" x="3" y="7" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    ),
    labelKey: "settings.nav.interview",
    value: "interview",
  },
  {
    icon: (
      <>
        <path d="M9 3v6" />
        <path d="M15 3v6" />
        <path d="M6 9h12v3a6 6 0 0 1-12 0z" />
        <path d="M12 18v3" />
      </>
    ),
    labelKey: "settings.nav.integrations",
    value: "integrations",
  },
  {
    icon: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
    labelKey: "settings.nav.notifications",
    value: "notifications",
  },
  {
    icon: (
      <>
        <rect height="14" rx="2" width="20" x="2" y="5" />
        <path d="M2 10h20" />
      </>
    ),
    labelKey: "settings.nav.billing",
    value: "billing",
  },
];

const navItemClass =
  "flex h-11 w-auto shrink-0 cursor-pointer items-center gap-[11px] whitespace-nowrap rounded-[11px] px-[13px] text-left font-title text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 min-[900px]:h-[37px] min-[900px]:w-full";

export function SettingsSectionNav({
  authProvider,
  onSectionChange,
  section,
}: {
  authProvider: "clerk" | "mock";
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
}) {
  const { t } = useTranslation();
  const navRef = React.useRef<HTMLElement | null>(null);

  /*
   * Below 900px the sections are a horizontal scroller, and the active one is
   * not always in view: `/settings?view=billing` is the seventh item, and it
   * is exactly where the credit pill in the mobile header sends people. They
   * would land on the billing pane with the rail still showing "Profile" —
   * no indication of where they are, or that the row scrolls at all.
   *
   * Clicking a tab focuses it, which the browser scrolls into view on its
   * own; arriving by URL or by history navigation does not, which is why
   * this keys on the section rather than on any interaction.
   */
  React.useEffect(() => {
    const nav = navRef.current;
    // Read back from the DOM rather than holding a ref on the active button:
    // a ref that moves between elements makes the effect depend on React's
    // detach/attach ordering, and `aria-current` already marks the one item
    // this is about.
    const item = nav?.querySelector('[aria-current="page"]');
    if (!nav || !item) return;
    // The rail (>=900px) is a column with nothing to scroll sideways.
    if (nav.scrollWidth <= nav.clientWidth) return;

    const navBox = nav.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    // Measured from rects rather than offsetLeft: offsetLeft is relative to
    // the nearest positioned ancestor, which this nav does not control.
    const centered =
      nav.scrollLeft +
      (itemBox.left - navBox.left) -
      (navBox.width - itemBox.width) / 2;

    // Deliberately instantaneous rather than `behavior: "smooth"`. The page
    // should arrive already positioned instead of animating itself in front of
    // the reader — and smooth scrolling is a no-op in automation browsers
    // (measured: `auto` lands, `smooth` leaves scrollLeft at 0), which would
    // have made this both unverifiable here and untestable in Playwright.
    // scrollTo clamps out-of-range values, so the first and last items simply
    // come to rest against their end of the row.
    nav.scrollTo({ behavior: "auto", left: centered });
  }, [section]);

  return (
    // Sign out stays out of the scroller below 900px — inside it, it would sit
    // past the right edge of a row the reader has no reason to scroll.
    //
    // `min-w-0` is load-bearing, not decoration: this div is a grid item, and a
    // grid item's default `min-width: auto` refuses to shrink below its content's
    // intrinsic width. Without it the row of seven buttons made this column
    // ~1090px wide inside a 390px viewport, the `overflow-x-auto` below never
    // engaged (nothing was overflowing — the COLUMN had grown), and the whole
    // page scrolled sideways instead.
    <div className="flex min-w-0 flex-col gap-3 min-[900px]:sticky min-[900px]:top-6 min-[900px]:gap-0">
      {/*
       * The scroller stays inside the page gutter. An earlier version bled out
       * to the screen edges by cancelling a `--shell-gutter` custom property
       * published by the shell — it looked slightly better (a tab cut off at
       * the very edge reads as "scroll for more") but it coupled this file to a
       * variable in another package, and a padding built on a variable
       * collapses to zero wherever that variable does not resolve. That cost
       * the whole page its margins on a real phone. The tab is now cut off
       * 16px in, which is a smaller price than a page with no gutter.
       */}
      <nav
        aria-label={t("settings.nav.aria")}
        className="flex gap-1.5 overflow-x-auto pb-1 min-[900px]:flex-col min-[900px]:gap-px min-[900px]:overflow-x-visible min-[900px]:pb-0"
        ref={navRef}
      >
        {settingsNavItems.map((item) => {
          const isActive = item.value === section;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                navItemClass,
                isActive
                  ? "bg-[#eef0e3] font-semibold text-[oklch(0.26_0.06_121)]"
                  : "font-medium text-ink-600 hover:bg-[rgba(26,23,20,0.05)] hover:text-ink-950",
              )}
              key={item.value}
              onClick={() => onSectionChange(item.value)}
              type="button"
            >
              <SettingsNavIcon isActive={isActive}>{item.icon}</SettingsNavIcon>
              <span className="flex-1">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="hidden bg-ink-100 min-[900px]:mx-1 min-[900px]:my-2.5 min-[900px]:block min-[900px]:h-px" />

      {authProvider === "clerk" ? (
        <ClerkSignOutButton label={t("settings.nav.signOut")} />
      ) : (
        <MockSignOutButton label={t("settings.nav.signOut")} />
      )}
    </div>
  );
}

function SettingsNavIcon({
  children,
  isActive,
}: {
  children: React.ReactNode;
  isActive: boolean;
}) {
  return (
    <span
      className={cn(
        "grid h-5 w-5 shrink-0 place-items-center",
        isActive ? "text-[oklch(0.40_0.09_121)]" : "text-ink-400",
      )}
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
        viewBox="0 0 24 24"
        width="17"
      >
        {children}
      </svg>
    </span>
  );
}

function ClerkSignOutButton({ label }: { label: string }) {
  const { signOut } = useClerk();

  return (
    <SignOutButton
      label={label}
      onClick={() => {
        void signOut({ redirectUrl: "/login" });
      }}
    />
  );
}

function MockSignOutButton({ label }: { label: string }) {
  const router = useRouter();

  return (
    <SignOutButton
      label={label}
      onClick={() => {
        router.push("/login");
      }}
    />
  );
}

function SignOutButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        navItemClass,
        "self-start font-medium text-[#a4493a] hover:bg-coral-50 min-[900px]:self-stretch",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">
        <svg
          aria-hidden="true"
          fill="none"
          height="17"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
          width="17"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}
