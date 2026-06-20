import * as React from "react";
import {
  Dashboard,
  Microphone,
} from "iconoir-react";

import { BrandMark } from "../components/brand-mark";
import { cn } from "../lib/cn";

const navItems = [
  { label: "Dashboard", href: "/", icon: Dashboard },
  { label: "New interview", href: "/interviews/new", icon: Microphone }
];

type EnterpriseAccount = {
  organizationName: string;
  userEmail: string;
  userName: string;
  role: string;
};

export function EnterpriseShell({
  account,
  accountActions,
  children,
  className
}: {
  account?: EnterpriseAccount;
  accountActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-screen bg-[linear-gradient(115deg,#f6f3ec_0%,#fbfaf7_48%,#f1f3e6_100%)] text-ink-900",
        className
      )}
    >
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-[#fbfaf7]/88 px-4 py-3 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <BrandMark />
            <nav className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => (
                <a
                  key={item.label}
                  className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3 text-sm font-medium text-ink-600 transition hover:bg-white/76 hover:text-ink-950"
                  href={item.href}
                >
                  <item.icon aria-hidden="true" className="h-4 w-4" />
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <div className="truncate text-sm font-medium text-ink-950">
                {account?.organizationName ?? "Recruiter console"}
              </div>
              {account ? (
                <div className="truncate text-xs text-ink-500">
                  {account.userName} · {formatRole(account.role)}
                </div>
              ) : null}
            </div>
            {accountActions ? <div className="shrink-0">{accountActions}</div> : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-8 sm:py-9">
        {children}
      </main>
    </div>
  );
}

function formatRole(role: string) {
  return role.replace(/_/g, " ");
}
