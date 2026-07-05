import * as React from "react";
import { Button as BaseButton } from "@base-ui-components/react/button";

import { cn } from "../lib/cn";

export type MetricCardProps = {
  active?: boolean;
  className?: string;
  icon?: React.ReactNode;
  label: React.ReactNode;
  meta?: React.ReactNode;
  onClick?: () => void;
  variant?: "kpi" | "summary";
  value: React.ReactNode;
};

function MetricCardContent({
  active,
  icon,
  label,
  meta,
  variant = "summary",
  value,
}: Omit<MetricCardProps, "className" | "onClick">) {
  if (variant === "kpi") {
    return (
      <>
        <div className="flex items-center justify-between gap-4">
          {icon ? (
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                active
                  ? "bg-white/60 text-olive-900"
                  : "bg-[#f4f2ea] text-ink-600",
              )}
            >
              {icon}
            </span>
          ) : null}
          <span className="text-4xl font-semibold leading-none tracking-normal text-ink-950">
            {value}
          </span>
        </div>
        <p className="mt-5 text-sm font-semibold text-ink-800">{label}</p>
        {meta ? <p className="mt-2 text-xs text-ink-500">{meta}</p> : null}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "text-[12.5px] font-semibold",
            active ? "text-olive-950" : "text-ink-700",
          )}
        >
          {label}
        </span>
        {icon ? (
          <span
            className={cn(
              "grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full",
              active
                ? "bg-white/60 text-olive-900"
                : "bg-[#f4f2ea] text-ink-600",
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink-950">
        {value}
      </p>
      {meta ? <p className="mt-2 text-xs text-ink-500">{meta}</p> : null}
    </>
  );
}

export function MetricCard({
  active = false,
  className,
  icon,
  label,
  meta,
  onClick,
  variant = "summary",
  value,
}: MetricCardProps) {
  const baseClassName = cn(
    "rounded-[20px] border p-[17px] text-left transition-colors",
    active ? "border-[#e2e6d3] bg-[#eef0e3]" : "border-ink-100 bg-white/72",
    onClick &&
      "cursor-pointer hover:border-ink-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
    className,
  );

  if (onClick) {
    return (
      <BaseButton
        aria-pressed={active}
        nativeButton
        className={baseClassName}
        onClick={onClick}
        type="button"
      >
        <MetricCardContent
          active={active}
          icon={icon}
          label={label}
          meta={meta}
          variant={variant}
          value={value}
        />
      </BaseButton>
    );
  }

  return (
    <div className={baseClassName}>
      <MetricCardContent
        active={active}
        icon={icon}
        label={label}
        meta={meta}
        variant={variant}
        value={value}
      />
    </div>
  );
}
