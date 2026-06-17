import * as React from "react";

import { cn } from "../lib/cn";

type PageHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  title: string;
  description?: string;
  actions?: React.ReactNode;
};

export function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-ink-200 pb-6 md:flex-row md:items-end md:justify-between",
        className
      )}
      {...props}
    >
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-ink-900">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
