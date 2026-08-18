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
        // Dark on purpose: the console itself is cream (`#F9F8F3`), so a dark
        // card is the strongest figure/ground this surface can produce.
        // `ink-900` at high opacity (not solid) keeps the glassy idiom the
        // light version used — contrast against `ink-50` text stays >13:1
        // composited over the app background even at this opacity (computed,
        // see the toast redesign report), so it survives the drop.
        "rounded-2xl border border-white/8 bg-ink-900/94 px-4 py-3 text-sm text-ink-50 shadow-[0_24px_48px_-16px_rgba(15,15,13,0.5),0_10px_24px_-10px_rgba(15,15,13,0.35)] backdrop-blur-md",
        className
      )}
      {...props}
    />
  );
}
