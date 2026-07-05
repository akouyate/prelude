"use client";

import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, NavArrowDown } from "iconoir-react";

import { cn } from "../lib/cn";
import { Field } from "./field";

export type SelectFieldOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

export type SelectFieldProps = {
  className?: string;
  defaultValue?: string | null;
  description?: React.ReactNode;
  disabled?: boolean;
  label: React.ReactNode;
  name?: string;
  onValueChange?: (value: string | null) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  required?: boolean;
  value?: string | null;
};

export type SelectControlProps = {
  ariaLabel?: string;
  className?: string;
  defaultValue?: string | null;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: string | null) => void;
  options: SelectFieldOption[];
  placeholder?: string;
  required?: boolean;
  value?: string | null;
};

export function SelectField({
  className,
  defaultValue,
  description,
  disabled,
  label,
  name,
  onValueChange,
  options,
  placeholder = "Select",
  required,
  value,
}: SelectFieldProps) {
  return (
    <Field
      className={className}
      description={description}
      disabled={disabled}
      label={label}
      name={name}
    >
      <SelectControl
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        required={required}
        value={value}
      />
    </Field>
  );
}

export function SelectControl({
  ariaLabel,
  className,
  defaultValue,
  disabled,
  name,
  onValueChange,
  options,
  placeholder = "Select",
  required,
  value,
}: SelectControlProps) {
  const itemLabels = React.useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options],
  );

  return (
    <BaseSelect.Root
      defaultValue={defaultValue}
      disabled={disabled}
      itemToStringLabel={(itemValue) =>
        typeof itemValue === "string"
          ? (itemLabels.get(itemValue) ?? itemValue)
          : ""
      }
      name={name}
      onValueChange={(nextValue) => {
        onValueChange?.(typeof nextValue === "string" ? nextValue : null);
      }}
      required={required}
      value={value ?? undefined}
    >
      <BaseSelect.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-[13px] border border-ink-200 bg-white px-3.5 text-left text-sm text-ink-950 transition hover:border-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <BaseSelect.Value>
          {(selectedValue) =>
            typeof selectedValue === "string"
              ? (itemLabels.get(selectedValue) ?? selectedValue)
              : placeholder
          }
        </BaseSelect.Value>
        <BaseSelect.Icon>
          <NavArrowDown aria-hidden={true} className="h-4 w-4 text-ink-400" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50 outline-none" sideOffset={6}>
          <BaseSelect.Popup className="max-h-[18rem] min-w-[var(--anchor-width)] overflow-y-auto rounded-[15px] border border-ink-100 bg-white p-1 shadow-soft outline-none">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  className="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-[11px] px-3 py-2 text-sm font-medium text-ink-800 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-[#f4f2ea] data-[selected]:text-olive-900"
                  disabled={option.disabled}
                  key={option.value}
                  value={option.value}
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check aria-hidden={true} className="h-4 w-4" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
