import * as React from "react";

import { cn } from "../lib/cn";

type NoticeTone = "danger" | "info" | "success" | "warning";

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone;
};

const toneClasses: Record<NoticeTone, string> = {
  danger: "border-coral-100 bg-coral-50 text-coral-800",
  info: "border-ink-100 bg-[#f7f7ef] text-ink-600",
  success: "border-[#dfe7ca] bg-[#f7f9ef] text-olive-900",
  warning: "border-gold-100 bg-[#fff8e6] text-gold-800",
};

export function Notice({
  className,
  tone = "info",
  ...props
}: NoticeProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2 text-[12.5px] leading-[1.45]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
