import * as React from "react";
import {
  Community,
  Dashboard,
  Suitcase,
  TaskList,
} from "iconoir-react";

import { cn } from "../lib/cn";

const navItems = [
  { label: "Dashboard", icon: Dashboard },
  { label: "Jobs", icon: Suitcase },
  { label: "Candidates", icon: Community },
  { label: "Interviews", icon: TaskList }
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
    <div className={cn("min-h-screen bg-ink-50 text-ink-900", className)}>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink-200 bg-white px-4 py-5 lg:block">
        <div className="text-lg font-semibold">Prelude.ai</div>
        {account ? (
          <div className="mt-5 rounded-xl border border-ink-200 bg-ink-50 p-3">
            <div className="truncate text-sm font-semibold text-ink-900">
              {account.organizationName}
            </div>
            <div className="mt-1 text-xs font-medium uppercase text-ink-500">
              {formatRole(account.role)}
            </div>
          </div>
        ) : null}
        <nav className="mt-8 space-y-1">
          {navItems.map((item) => (
            <a
              key={item.label}
              className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
              href="#"
            >
              <item.icon aria-hidden="true" className="h-4 w-4" />
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <div className="sticky top-0 z-10 border-b border-ink-200 bg-white/92 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center justify-between">
            <span className="font-semibold lg:hidden">Prelude.ai</span>
            <div className="flex min-w-0 items-center gap-3">
              {accountActions ? (
                <div className="shrink-0">{accountActions}</div>
              ) : null}
              <div className="min-w-0 text-right">
                <div className="truncate text-sm font-medium text-ink-900">
                  {account?.organizationName ?? "Recruiter console"}
                </div>
                {account ? (
                  <div className="truncate text-xs text-ink-500">
                    {account.userName} - {formatRole(account.role)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

function formatRole(role: string) {
  return role.replace(/_/g, " ");
}
