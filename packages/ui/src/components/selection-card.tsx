import * as React from "react";
import { Button as BaseButton } from "@base-ui-components/react/button";
import { Check } from "iconoir-react";

import { cn } from "../lib/cn";

export function selectionCardClasses({
  disabled = false,
  selected = false,
}: {
  disabled?: boolean;
  selected?: boolean;
}) {
  if (disabled) {
    return "cursor-not-allowed border border-[#e7e2d8] bg-white/46 text-ink-400 opacity-75";
  }

  return cn(
    "cursor-pointer border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-olive-300",
    selected
      ? "border-[#d8deca] bg-[#f3f4ea] text-olive-950"
      : "border-[#e7e2d8] bg-white/72 text-ink-700 hover:border-[#d1cbbf] hover:bg-white",
  );
}

export function SelectionIndicator({
  checked,
  className,
  shape = "square",
}: {
  checked: boolean;
  className?: string;
  shape?: "circle" | "square";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center border transition-colors",
        shape === "circle" ? "h-5 w-5 rounded-full" : "h-5 w-5 rounded-[7px]",
        checked
          ? "border-olive-900 bg-olive-900 text-white"
          : "border-[#cfc8bb] bg-white/72 text-transparent",
        className,
      )}
    >
      {checked ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

export type SelectionCardProps =
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    description?: React.ReactNode;
    indicatorShape?: "circle" | "square";
    meta?: React.ReactNode;
    selected?: boolean;
    title: React.ReactNode;
  };

export const SelectionCard = React.forwardRef<HTMLElement, SelectionCardProps>(
  (
    {
      className,
      description,
      disabled,
      indicatorShape = "square",
      meta,
      selected = false,
      title,
      type = "button",
      ...props
    },
    ref,
  ) => {
    return (
      <BaseButton
        aria-pressed={selected}
        disabled={disabled}
        nativeButton
        ref={ref}
        type={type}
        className={cn(
          selectionCardClasses({ disabled, selected }),
          "flex w-full items-start gap-3 rounded-[20px] p-4 text-left",
          className,
        )}
        {...props}
      >
        <SelectionIndicator checked={selected} shape={indicatorShape} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">
            {title}
          </span>
          {description ? (
            <span className="mt-1 block text-sm leading-5 text-ink-600">
              {description}
            </span>
          ) : null}
          {meta ? (
            <span className="mt-2 block text-xs font-medium text-ink-500">
              {meta}
            </span>
          ) : null}
        </span>
      </BaseButton>
    );
  },
);

SelectionCard.displayName = "SelectionCard";
