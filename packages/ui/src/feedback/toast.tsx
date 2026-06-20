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
        "rounded-2xl border border-ink-100 bg-white/86 px-4 py-3 text-sm text-ink-800 backdrop-blur",
        className
      )}
      {...props}
    />
  );
}
