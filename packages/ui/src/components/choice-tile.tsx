import * as React from "react";
import { Check } from "iconoir-react";
import { Button as BaseButton } from "@base-ui-components/react/button";

import { cn } from "../lib/cn";

export type ChoiceTileProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  description?: string;
  focusableWhenDisabled?: boolean;
  icon?: React.ReactNode;
  meta?: string;
  selected?: boolean;
  title: string;
};

export const ChoiceTile = React.forwardRef<HTMLElement, ChoiceTileProps>(
  (
    {
      className,
      description,
      icon,
      meta,
      selected = false,
      title,
      type = "button",
      ...props
    },
    ref
  ) => {
    return (
      <BaseButton
        ref={ref}
        aria-pressed={selected}
        nativeButton
        type={type}
        className={cn(
          "group relative flex min-h-36 w-full cursor-pointer flex-col items-center justify-center rounded-xl border p-5 text-center transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          selected
            ? "border-olive-700 bg-[#f0f1e6] text-ink-900 shadow-[0_16px_36px_rgb(23_23_21/0.08)]"
            : "border-ink-100 bg-white/55 text-ink-900 hover:border-ink-300 hover:bg-white",
          className
        )}
        {...props}
      >
        {selected ? (
          <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-olive-800 text-white">
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "mb-4 grid h-12 w-12 place-items-center rounded-md border text-ink-900",
              selected ? "border-olive-700 bg-white/70" : "border-ink-100 bg-ink-50/60"
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="text-base font-semibold leading-tight">{title}</span>
        {description ? (
          <span className="mt-2 max-w-60 text-sm leading-5 text-ink-600">
            {description}
          </span>
        ) : null}
        {meta ? (
          <span className="mt-3 rounded-sm bg-white/70 px-2 py-1 text-xs font-medium text-ink-600">
            {meta}
          </span>
        ) : null}
      </BaseButton>
    );
  }
);

ChoiceTile.displayName = "ChoiceTile";
