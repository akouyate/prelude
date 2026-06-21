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
    <Tabs.Root
      className={className}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      value={value}
    >
      <Tabs.List
        activateOnFocus
        aria-label={ariaLabel}
        className="flex items-center gap-1 rounded-full border border-ink-100 bg-[#f1efe6] p-1"
      >
        {options.map((option) => {
          const active = option.value === value;

          return (
            <Tabs.Tab
              className={cn(
                "inline-flex h-[30px] cursor-pointer items-center rounded-full px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
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
