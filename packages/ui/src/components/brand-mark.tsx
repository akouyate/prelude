import * as React from "react";

import hireCallLogo from "../assets/hirecall-inline-black.svg";
import { cn } from "../lib/cn";

type BrandMarkProps = React.HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  labelClassName?: string;
  markClassName?: string;
};

const hireCallLogoSource =
  typeof hireCallLogo === "string" ? hireCallLogo : hireCallLogo.src;

export function BrandMark({
  className,
  compact = false,
  labelClassName,
  markClassName,
  ...props
}: BrandMarkProps) {
  return (
    <div className={cn("flex items-center", className)} {...props}>
      {compact ? (
        <span
          className={cn(
            "block h-8 w-8 shrink-0 overflow-hidden",
            markClassName,
          )}
        >
          <img
            alt="HireCall"
            className="h-full w-auto max-w-none"
            src={hireCallLogoSource}
          />
        </span>
      ) : (
        <img
          alt="HireCall"
          className={cn("h-8 w-auto max-w-36", labelClassName)}
          src={hireCallLogoSource}
        />
      )}
    </div>
  );
}
