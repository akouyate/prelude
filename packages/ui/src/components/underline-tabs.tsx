"use client";

import * as React from "react";
import { Tabs } from "@base-ui-components/react/tabs";

import { cn } from "../lib/cn";

export type UnderlineTabOption<TValue extends string> = {
  count?: number | string;
  disabled?: boolean;
  label: string;
  value: TValue;
};

export type UnderlineTabsProps<TValue extends string> = {
  activeTabClassName?: string;
  ariaLabel: string;
  className?: string;
  inactiveTabClassName?: string;
  listClassName?: string;
  onValueChange: (value: TValue) => void;
  options: Array<UnderlineTabOption<TValue>>;
  tabClassName?: string;
  value: TValue;
};

export function UnderlineTabs<TValue extends string>({
  activeTabClassName,
  ariaLabel,
  className,
  inactiveTabClassName,
  listClassName,
  onValueChange,
  options,
  tabClassName,
  value,
}: UnderlineTabsProps<TValue>) {
  return (
    <Tabs.Root
      className={className}
      onValueChange={(nextValue) => onValueChange(nextValue as TValue)}
      value={value}
    >
      <Tabs.List
        activateOnFocus
        aria-label={ariaLabel}
        className={cn(
          "flex gap-6 overflow-x-auto border-b border-ink-100",
          listClassName,
        )}
      >
        {options.map((option) => {
          const active = option.value === value;
          const hasCount =
            option.count !== undefined &&
            option.count !== null &&
            String(option.count).length > 0;

          return (
            <Tabs.Tab
              className={cn(
                "inline-flex h-[42px] shrink-0 cursor-pointer items-center gap-2 border-b-2 border-transparent px-0 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-ink-950 text-ink-950"
                  : "text-ink-500 hover:border-ink-300 hover:text-ink-900",
                active ? activeTabClassName : inactiveTabClassName,
                tabClassName,
              )}
              disabled={option.disabled}
              key={option.value}
              type="button"
              value={option.value}
            >
              {option.label}
              {hasCount ? (
                <span
                  className={cn(
                    "inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                    active
                      ? "bg-[#eef0e3] text-olive-900"
                      : "bg-ink-100 text-ink-500",
                  )}
                >
                  {option.count}
                </span>
              ) : null}
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
