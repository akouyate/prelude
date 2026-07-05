import * as React from "react";

import { cn } from "../lib/cn";

type SurfaceTone = "default" | "muted" | "dark";
type SurfacePadding = "none" | "sm" | "md" | "lg";

export type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: "article" | "aside" | "div" | "section";
  padding?: SurfacePadding;
  tone?: SurfaceTone;
};

const toneClasses: Record<SurfaceTone, string> = {
  default: "border-ink-100 bg-white/76",
  muted: "border-ink-100 bg-[#f9f8f3]",
  dark: "border-ink-900 bg-ink-900 text-white",
};

const paddingClasses: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export function Surface({
  as: Component = "section",
  className,
  padding = "md",
  tone = "default",
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        "rounded-[22px] border backdrop-blur",
        toneClasses[tone],
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  );
}
