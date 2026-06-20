import * as React from "react";

import { Badge } from "./badge";
import { cn } from "../lib/cn";

type StatusTone =
  | "danger"
  | "dark"
  | "muted"
  | "neutral"
  | "olive"
  | "success"
  | "warning";

type StatusBadgeProps = React.ComponentProps<typeof Badge> & {
  tone?: StatusTone;
};

const toneClasses: Record<StatusTone, string> = {
  danger: "bg-coral-50 text-coral-800",
  dark: "bg-ink-900 text-white",
  muted: "bg-ink-100 text-ink-600",
  neutral: "bg-white text-ink-700",
  olive: "bg-[#eef0e3] text-olive-900",
  success: "bg-meadow-50 text-meadow-800",
  warning: "bg-gold-100 text-gold-800",
};

export function StatusBadge({
  className,
  tone = "olive",
  ...props
}: StatusBadgeProps) {
  return <Badge className={cn(toneClasses[tone], className)} {...props} />;
}
