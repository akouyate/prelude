import * as React from "react";

import hireCallAppIcon from "../assets/hirecall-app-icon-black.svg";
import hireCallAppIconColor from "../assets/hirecall-app-icon-color.svg";
import hireCallAppIconIvory from "../assets/hirecall-app-icon-ivory.svg";
import hireCallWordmark from "../assets/hirecall-wordmark-black.svg";
import hireCallWordmarkColor from "../assets/hirecall-wordmark-color.svg";
import hireCallWordmarkWhite from "../assets/hirecall-wordmark-white.svg";
import { cn } from "../lib/cn";

type BrandMarkProps = React.HTMLAttributes<HTMLDivElement> & {
  appearance?: "color" | "on-dark" | "on-light";
  compact?: boolean;
  labelClassName?: string;
  markClassName?: string;
};

function assetSource(asset: string | { src: string }) {
  return typeof asset === "string" ? asset : asset.src;
}

const hireCallAppIconSource = assetSource(hireCallAppIcon);
const hireCallAppIconColorSource = assetSource(hireCallAppIconColor);
const hireCallAppIconIvorySource = assetSource(hireCallAppIconIvory);
const hireCallWordmarkSource = assetSource(hireCallWordmark);
const hireCallWordmarkColorSource = assetSource(hireCallWordmarkColor);
const hireCallWordmarkWhiteSource = assetSource(hireCallWordmarkWhite);

const markSourceByAppearance = {
  color: hireCallAppIconColorSource,
  "on-dark": hireCallAppIconIvorySource,
  "on-light": hireCallAppIconSource,
} as const;

const wordmarkSourceByAppearance = {
  color: hireCallWordmarkColorSource,
  "on-dark": hireCallWordmarkWhiteSource,
  "on-light": hireCallWordmarkSource,
} as const;

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
          src={markSourceByAppearance[appearance]}
        />
      ) : (
        <img
          alt="HireCall"
          className={cn("h-8 w-auto max-w-36", labelClassName)}
          src={wordmarkSourceByAppearance[appearance]}
        />
      )}
    </div>
  );
}
