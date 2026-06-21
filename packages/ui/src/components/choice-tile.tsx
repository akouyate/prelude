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
          "group relative flex min-h-36 w-full cursor-pointer flex-col items-center justify-center rounded-3xl border p-5 text-center transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          selected
            ? "border-[#d8deca] bg-[#f3f4ea] text-ink-950"
            : "border-[#e7e2d8] bg-white/72 text-ink-900 hover:border-[#d1cbbf] hover:bg-white",
          className
        )}
        {...props}
      >
        {selected ? (
          <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-olive-900 text-white">
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "mb-4 grid h-12 w-12 place-items-center rounded-2xl border text-ink-900",
              selected
                ? "border-[#d8deca] bg-white/72"
                : "border-[#e7e2d8] bg-[#f7f6f1]"
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
          <span className="mt-3 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-ink-600">
            {meta}
          </span>
        ) : null}
      </BaseButton>
    );
  }
);

ChoiceTile.displayName = "ChoiceTile";
