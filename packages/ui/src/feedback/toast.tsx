import * as React from "react";

import { cn } from "../lib/cn";

export function Toast({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-800 shadow-soft",
        className
      )}
      {...props}
    />
  );
}
