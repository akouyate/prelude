import * as React from "react";
import { Sparks } from "iconoir-react";

import { cn } from "../lib/cn";

type BrandMarkProps = React.HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  labelClassName?: string;
  markClassName?: string;
};

export function BrandMark({
  className,
  compact = false,
  labelClassName,
  markClassName,
  ...props
}: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <span
        className={cn(
          "grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-white",
          markClassName,
        )}
      >
        <Sparks aria-hidden="true" className="h-4 w-4" />
      </span>
      {compact ? null : (
        <span
          className={cn(
            "text-sm font-semibold tracking-[0.01em] text-ink-950",
            labelClassName,
          )}
        >
          Prelude.ai
        </span>
      )}
    </div>
  );
}
