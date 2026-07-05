import * as React from "react";

import { cn } from "../lib/cn";

type PillTone =
  | "danger"
  | "gold"
  | "ink"
  | "muted"
  | "neutral"
  | "olive"
  | "success";

export type PillProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
};

const toneClasses: Record<PillTone, string> = {
  danger: "bg-coral-50 text-coral-800",
  gold: "bg-gold-100 text-gold-800",
  ink: "bg-ink-900 text-white",
  muted: "bg-ink-100 text-ink-600",
  neutral: "bg-white text-ink-700",
  olive: "bg-[#eef0e3] text-olive-900",
  success: "bg-meadow-50 text-meadow-800",
};

export function Pill({ className, tone = "olive", ...props }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
