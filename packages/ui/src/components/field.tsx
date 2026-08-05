"use client";

import * as React from "react";
import { Field as BaseField } from "@base-ui-components/react/field";

import { cn } from "../lib/cn";
import { Input, type InputProps } from "./input";

export type FieldProps = React.ComponentProps<typeof BaseField.Root> & {
  children: React.ReactNode;
  description?: React.ReactNode;
  /** Shown under the control and marks it invalid. Server-side messages belong
   * here; native constraint messages are rendered by the browser. */
  error?: React.ReactNode;
  label: React.ReactNode;
  labelAddon?: React.ReactNode;
};

export function Field({
  children,
  className,
  description,
  error,
  label,
  labelAddon,
  ...props
}: FieldProps) {
  return (
    <BaseField.Root
      className={cn("flex flex-col gap-2", className)}
      // Base UI owns the `aria-invalid` and `aria-describedby` wiring between the
      // control and the message, so neither is hand-rolled here.
      invalid={Boolean(error) || props.invalid}
      {...props}
    >
      <div className="flex items-center justify-between gap-3">
        <BaseField.Label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
          {label}
        </BaseField.Label>
        {labelAddon ? (
          <span className="shrink-0 text-xs text-ink-400">{labelAddon}</span>
        ) : null}
      </div>
      {children}
      {description ? (
        <BaseField.Description className="text-[12px] leading-[1.45] text-ink-500">
          {description}
        </BaseField.Description>
      ) : null}
      {error ? (
        <BaseField.Error
          className="text-[12px] font-medium leading-[1.45] text-coral-700"
          match={true}
        >
          {error}
        </BaseField.Error>
      ) : null}
    </BaseField.Root>
  );
}

export type TextFieldProps = Omit<FieldProps, "children"> &
  Omit<InputProps, "className"> & {
    controlClassName?: string;
  };

export function TextField({
  className,
  controlClassName,
  description,
  error,
  label,
  labelAddon,
  ...props
}: TextFieldProps) {
  return (
    <Field
      className={className}
      description={description}
      disabled={props.disabled}
      error={error}
      label={label}
      labelAddon={labelAddon}
      name={props.name}
    >
      <Input
        className={cn(
          "h-11 rounded-[13px] px-3.5",
          error && "border-coral-600 focus:border-coral-700",
          controlClassName,
        )}
        {...props}
      />
    </Field>
  );
}
