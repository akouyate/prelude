import * as React from "react";

import { cn } from "../lib/cn";

export function CandidateShell({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "min-h-screen bg-ink-900 px-4 py-5 text-white sm:px-6",
        className
      )}
    >
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col">
        <div className="mb-8 text-sm font-semibold text-white/80">Prelude.ai</div>
        {children}
      </div>
    </main>
  );
}
