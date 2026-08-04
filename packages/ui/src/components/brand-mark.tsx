import * as React from "react";

import hireCallAppIcon from "../assets/hirecall-app-icon-black.svg";
import hireCallAppIconIvory from "../assets/hirecall-app-icon-ivory.svg";
import hireCallWordmark from "../assets/hirecall-wordmark-black.svg";
import hireCallWordmarkWhite from "../assets/hirecall-wordmark-white.svg";
import { cn } from "../lib/cn";

type BrandMarkProps = React.HTMLAttributes<HTMLDivElement> & {
  appearance?: "on-dark" | "on-light";
  compact?: boolean;
  labelClassName?: string;
  markClassName?: string;
};

function assetSource(asset: string | { src: string }) {
  return typeof asset === "string" ? asset : asset.src;
}

const hireCallAppIconSource = assetSource(hireCallAppIcon);
const hireCallAppIconIvorySource = assetSource(hireCallAppIconIvory);
const hireCallWordmarkSource = assetSource(hireCallWordmark);
const hireCallWordmarkWhiteSource = assetSource(hireCallWordmarkWhite);

export function BrandMark({
  appearance = "on-light",
  className,
  compact = false,
  labelClassName,
  markClassName,
  ...props
}: BrandMarkProps) {
  return (
    <div className={cn("flex items-center", className)} {...props}>
      {compact ? (
        <img
          alt="HireCall"
          className={cn("block h-8 w-8 shrink-0", markClassName)}
          src={
            appearance === "on-dark"
              ? hireCallAppIconIvorySource
              : hireCallAppIconSource
          }
        />
      ) : (
        <img
          alt="HireCall"
          className={cn("h-8 w-auto max-w-36", labelClassName)}
          src={
            appearance === "on-dark"
              ? hireCallWordmarkWhiteSource
              : hireCallWordmarkSource
          }
        />
      )}
    </div>
  );
}
