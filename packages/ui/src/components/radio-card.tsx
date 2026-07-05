"use client";

import * as React from "react";
import { Radio } from "@base-ui-components/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui-components/react/radio-group";
import { Check } from "iconoir-react";

import { cn } from "../lib/cn";
import { selectionCardClasses } from "./selection-card";

export type RadioCardOption<TValue extends string> = {
  description?: React.ReactNode;
  disabled?: boolean;
  label: React.ReactNode;
  meta?: React.ReactNode;
  value: TValue;
};

export type RadioCardGroupProps<TValue extends string> = {
  ariaLabel: string;
  cardClassName?: string;
  className?: string;
  contentClassName?: string;
  defaultValue?: TValue;
  disabled?: boolean;
  indicatorShape?: "circle" | "square";
  name?: string;
  onValueChange?: (value: TValue) => void;
  options: Array<RadioCardOption<TValue>>;
  required?: boolean;
  showIndicator?: boolean;
  value?: TValue;
};

export function RadioCardGroup<TValue extends string>({
  ariaLabel,
  cardClassName,
  className,
  contentClassName,
  defaultValue,
  disabled,
  indicatorShape = "square",
  name,
  onValueChange,
  options,
  required,
  showIndicator = true,
  value,
}: RadioCardGroupProps<TValue>) {
  return (
    <BaseRadioGroup
      aria-label={ariaLabel}
      className={cn("grid gap-2", className)}
      defaultValue={defaultValue}
      disabled={disabled}
      name={name}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") {
          onValueChange?.(nextValue as TValue);
        }
      }}
      required={required}
      value={value}
    >
      {options.map((option) => (
        <Radio.Root
          className={(state) =>
            cn(
              selectionCardClasses({
                disabled: disabled || option.disabled,
                selected: state.checked,
              }),
              "flex w-full items-start gap-3 rounded-[20px] p-4 text-left",
              cardClassName,
            )
          }
          disabled={option.disabled}
          key={option.value}
          value={option.value}
        >
          {showIndicator ? (
            <Radio.Indicator
              keepMounted
              className={(state) =>
                cn(
                  "mt-0.5 grid shrink-0 place-items-center border transition-colors",
                  indicatorShape === "circle"
                    ? "h-5 w-5 rounded-full"
                    : "h-5 w-5 rounded-[7px]",
                  state.checked
                    ? "border-olive-900 bg-olive-900 text-white"
                    : "border-[#cfc8bb] bg-white/72 text-transparent",
                )
              }
            >
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            </Radio.Indicator>
          ) : null}
          <span className={cn("min-w-0 flex-1", contentClassName)}>
            <span className="block text-sm font-semibold text-ink-900">
              {option.label}
            </span>
            {option.description ? (
              <span className="mt-1 block text-sm leading-5 text-ink-600">
                {option.description}
              </span>
            ) : null}
            {option.meta ? (
              <span className="mt-2 block text-xs font-medium text-ink-500">
                {option.meta}
              </span>
            ) : null}
          </span>
        </Radio.Root>
      ))}
    </BaseRadioGroup>
  );
}
