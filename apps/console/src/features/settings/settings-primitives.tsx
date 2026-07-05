"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Field,
  SectionHeading,
  SelectField,
  Surface,
  Switch,
  TextField,
  cn,
} from "@prelude/ui";

export function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Surface className={className} padding="lg">
      {children}
    </Surface>
  );
}

export function SettingsPanelHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return <SectionHeading description={description} title={title} />;
}

export function SettingsField({
  label,
  maxLength,
  name,
  placeholder,
  readOnly = false,
  required = false,
  value,
}: {
  label: string;
  maxLength?: number;
  name?: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  value: string;
}) {
  const [currentValue, setCurrentValue] = React.useState(value);

  React.useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  return (
    <TextField
      label={label}
      maxLength={maxLength}
      name={name}
      onValueChange={setCurrentValue}
      placeholder={placeholder}
      readOnly={readOnly}
      required={required}
      value={currentValue}
    />
  );
}

export function SettingsUrlField({
  label,
  prefix,
  value,
}: {
  label: string;
  prefix: string;
  value: string;
}) {
  return (
    <Field label={label}>
      <span className="flex h-11 items-center rounded-[13px] border border-[#e2ddd2] bg-[#f7f6f1] px-3.5">
        <span className="text-sm text-ink-400">{prefix}</span>
        <input
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink-950 outline-none"
          readOnly
          value={value}
        />
      </span>
    </Field>
  );
}

export function SettingsSelectField({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  const [currentValue, setCurrentValue] = React.useState(value);

  React.useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  return (
    <SelectField
      label={label}
      name={name}
      onValueChange={(nextValue) => {
        setCurrentValue(nextValue ?? "");
      }}
      options={options}
      value={currentValue}
    />
  );
}

export function SettingsActionRow({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex justify-end gap-2.5">
      <Button type="reset" variant="secondary">
        {t("settings.actions.cancel")}
      </Button>
      <Button disabled={disabled} type="submit">
        {t("settings.actions.save")}
      </Button>
    </div>
  );
}

export function SettingsToggleRow({
  checked,
  defaultChecked = false,
  description,
  label,
  name,
  onCheckedChange,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  description: string;
  label: string;
  name?: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const currentValue = checked ?? defaultChecked;

  return (
    <div className="flex items-center justify-between gap-5 border-t border-[#f1ede4] py-4 first:border-t-0">
      {name ? (
        <input name={name} type="hidden" value={String(currentValue)} />
      ) : null}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950">{label}</p>
        <p className="mt-1 max-w-[48ch] text-[12.5px] leading-5 text-ink-500">
          {description}
        </p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        className="shrink-0"
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function AvatarToken({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-[#eef0e3] font-semibold text-olive-900",
        className,
      )}
    >
      {children}
    </span>
  );
}
