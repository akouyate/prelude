import * as React from "react";

import { cn } from "../lib/cn";

export type SectionHeadingProps = React.HTMLAttributes<HTMLDivElement> & {
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
};

export function SectionHeading({
  className,
  description,
  eyebrow,
  title,
  ...props
}: SectionHeadingProps) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      {eyebrow ? (
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink-400">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink-950">
        {title}
      </h2>
      {description ? (
        <p className="mt-[5px] text-[13.5px] leading-6 text-ink-500">
          {description}
        </p>
      ) : null}
    </div>
  );
}
