import * as React from "react";

import { cn } from "../lib/cn";

type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  description: string;
};

export function EmptyState({
  title,
  description,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-ink-300 bg-ink-50 px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      <h2 className="text-base font-semibold text-ink-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-600">
        {description}
      </p>
    </div>
  );
}
