import * as React from "react";

import { cn } from "../lib/cn";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn("rounded-2xl border border-ink-200 bg-white shadow-soft", className)}
      {...props}
    />
  );
}
