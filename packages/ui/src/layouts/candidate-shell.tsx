import * as React from "react";

import { BrandMark } from "../components/brand-mark";
import { cn } from "../lib/cn";

/*
 * The candidate experience is a sequence of full-height screens, each with its
 * own header (brand on the left and a status pill on the right — or a Back
 * action with the brand pushed right on setup). The shell therefore owns
 * nothing but the paper ground and the vertical flow; chrome belongs to the
 * screen so it can change from step to step.
 */
export function CandidateShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-screen flex-col bg-paper text-ink-950",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function CandidateScreenHeader({
  className,
  left,
  right,
}: {
  className?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-4 px-[clamp(1.125rem,5vw,2.75rem)] py-[1.375rem]",
        className,
      )}
    >
      {left}
      {right}
    </header>
  );
}

export function CandidateWordmark({ className }: { className?: string }) {
  return (
    <BrandMark
      appearance="color"
      className="shrink-0"
      labelClassName={cn("h-[22px] w-auto max-w-none", className)}
    />
  );
}

export function CandidateMonoPill({
  children,
  className,
  tone = "outline",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "outline" | "tint";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[1.875rem] shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-[0.8125rem] font-mono text-[0.625rem] uppercase tracking-[0.09em]",
        tone === "tint"
          ? "bg-spruce-50 tracking-[0.1em] text-spruce-800"
          : "border border-ink-200 bg-white text-ink-700",
        className,
      )}
    >
      {children}
    </span>
  );
}
