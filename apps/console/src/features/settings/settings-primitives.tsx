"use client";

import type { ReactNode } from "react";
import { NavArrowDown } from "iconoir-react";
import { useTranslation } from "react-i18next";
import { Button, Input, Switch, cn } from "@prelude/ui";

export function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[22px] border border-[#ece8de] bg-white/74 p-6 backdrop-blur",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SettingsPanelHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink-950">
        {title}
      </h2>
      <p className="mt-1 text-[13.5px] leading-6 text-ink-500">
        {description}
      </p>
    </div>
  );
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
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">{label}</span>
      <Input
        className="h-11 rounded-[13px] border-[#e2ddd2] bg-white px-3.5 focus:border-ink-900 focus:ring-[#e5e8d6]"
        defaultValue={value}
        maxLength={maxLength}
        name={name}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
      />
    </label>
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
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">{label}</span>
      <span className="flex h-11 items-center rounded-[13px] border border-[#e2ddd2] bg-[#f7f6f1] px-3.5">
        <span className="text-sm text-ink-400">{prefix}</span>
        <input
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink-950 outline-none"
          readOnly
          value={value}
        />
      </span>
    </label>
  );
}

export function SettingsSelectLike({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">{label}</span>
      <button
        className="flex h-11 cursor-pointer items-center justify-between rounded-[13px] border border-[#e2ddd2] bg-white px-3.5 text-left text-sm text-ink-950 transition hover:border-[#c8c1b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
        type="button"
      >
        {value}
        <NavArrowDown aria-hidden={true} className="h-4 w-4 text-ink-400" />
      </button>
    </label>
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
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-semibold text-ink-700">{label}</span>
      <div className="relative">
        <select
          className="h-11 w-full cursor-pointer appearance-none rounded-[13px] border border-[#e2ddd2] bg-white px-3.5 pr-10 text-left text-sm text-ink-950 transition hover:border-[#c8c1b2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          defaultValue={value}
          name={name}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <NavArrowDown
          aria-hidden={true}
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
        />
      </div>
    </label>
  );
}

export function SettingsActionRow({ disabled = false }: { disabled?: boolean }) {
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
