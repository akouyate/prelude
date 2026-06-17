import * as React from "react";
import { BriefcaseBusiness, ClipboardList, LayoutDashboard, Users } from "lucide-react";

import { cn } from "../lib/cn";

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Jobs", icon: BriefcaseBusiness },
  { label: "Candidates", icon: Users },
  { label: "Interviews", icon: ClipboardList }
];

export function EnterpriseShell({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-screen bg-ink-50 text-ink-900", className)}>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink-200 bg-white px-4 py-5 lg:block">
        <div className="text-lg font-semibold">Prelude.ai</div>
        <nav className="mt-8 space-y-1">
          {navItems.map((item) => (
            <a
              key={item.label}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
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
            <span className="text-sm text-ink-600">Recruiter console</span>
          </div>
        </div>
        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
