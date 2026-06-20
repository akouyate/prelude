import * as React from "react";

import { cn } from "../lib/cn";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-ink-100 bg-white/76 backdrop-blur",
        className
      )}
      {...props}
    />
  );
}
