import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export type StepShellProps = {
  children: ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
  title: ReactNode;
};

export function StepShell({
  children,
  className,
  description,
  eyebrow,
  footer,
  title
}: StepShellProps) {
  return (
    <main
      className={cn(
        "mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col px-5 pb-10 pt-10 sm:px-8 sm:pb-8 sm:pt-16",
        className
      )}
    >
      <div className="mx-auto w-full max-w-3xl">
        {eyebrow ? (
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-olive-800">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-title max-w-3xl text-balance text-4xl font-semibold leading-[1.04] tracking-normal text-ink-900 sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-7 text-ink-600 sm:text-lg">
            {description}
          </p>
        ) : null}
      </div>

      <div className="mx-auto mt-10 w-full max-w-3xl">{children}</div>

      {footer ? (
        <div className="mx-auto mt-8 w-full max-w-3xl">
          {footer}
        </div>
      ) : null}
    </main>
  );
}
