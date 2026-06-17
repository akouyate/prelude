import * as React from "react";

import { cn } from "../lib/cn";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm bg-gold-100 px-2 py-1 text-xs font-medium text-gold-800",
        className
      )}
      {...props}
    />
  );
}
