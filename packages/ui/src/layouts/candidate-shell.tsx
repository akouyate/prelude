import * as React from "react";

import { BrandMark } from "../components/brand-mark";
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
        "min-h-screen bg-[radial-gradient(circle_at_top_left,#3c421f_0,#171715_34%,#10100f_100%)] px-4 py-5 text-white sm:px-6",
        className
      )}
    >
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col">
        <div className="mb-8">
          <BrandMark
            labelClassName="text-white"
            markClassName="bg-white text-ink-900"
          />
        </div>
        {children}
      </div>
    </main>
  );
}
