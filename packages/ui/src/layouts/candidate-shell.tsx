import * as React from "react";

import { BrandMark } from "../components/brand-mark";
import { cn } from "../lib/cn";

export function CandidateShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "min-h-screen bg-ink-50 px-4 py-5 text-ink-950 sm:px-6",
        className,
      )}
    >
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between gap-4">
          <BrandMark />
          <span className="hidden rounded-full border border-ink-100 bg-white/62 px-3 py-1 text-xs font-medium text-ink-600 sm:inline-flex">
            Candidate interview
          </span>
        </header>
        {children}
      </div>
    </main>
  );
}
