"use client";

import * as React from "react";
import { Tabs } from "@base-ui-components/react/tabs";

import { cn } from "../lib/cn";

export type SegmentedTabOption<TValue extends string> = {
  disabled?: boolean;
  label: string;
  value: TValue;
};

export type SegmentedTabsProps<TValue extends string> = {
  ariaLabel: string;
  className?: string;
  onValueChange: (value: TValue) => void;
  options: Array<SegmentedTabOption<TValue>>;
  value: TValue;
};

export function SegmentedTabs<TValue extends string>({
  ariaLabel,
  className,
  onValueChange,
  options,
  value,
}: SegmentedTabsProps<TValue>) {
  return (
    /*
     * `min-w-0` and the scroller below are what keep this control inside a
     * narrow screen. Every caller puts it in a flex or grid container, where
     * the default `min-width: auto` refuses to shrink an item below its
     * content — five tabs then pushed the whole page wider than the viewport
     * and every page scrolled sideways. Shrinking here rather than at each
     * call site: it is the control that knows it can scroll instead.
     */
    <Tabs.Root
      className={cn("min-w-0 max-w-full", className)}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      value={value}
    >
      <Tabs.List
        activateOnFocus
        aria-label={ariaLabel}
        // The scrollbar is hidden because it would sit inside a 38px pill and
        // read as damage; the affordance is the cut-off tab at the edge, and
        // keyboard users still reach every tab (arrow keys move focus, which
        // scrolls it into view).
        className="flex items-center gap-1 overflow-x-auto rounded-full border border-ink-100 bg-[#f1efe6] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {options.map((option) => {
          const active = option.value === value;

          return (
            <Tabs.Tab
              className={cn(
                // `shrink-0` so tabs scroll past the edge intact rather than
                // squeezing their labels into an unreadable column.
                "inline-flex h-[30px] shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
                active
                  ? "bg-white text-ink-950"
                  : "text-ink-500 hover:bg-white/54 hover:text-ink-900",
              )}
              disabled={option.disabled}
              key={option.value}
              type="button"
              value={option.value}
            >
              {option.label}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
