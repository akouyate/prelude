"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle,
  NavArrowLeft,
  RefreshCircle,
} from "iconoir-react";
import { useTranslation } from "react-i18next";

import type { RoleIntakeSummary } from "@prelude/contracts";
import { cn } from "@prelude/ui";

import {
  getRoleIntakeProgress,
  type RoleIntakeProgressStep,
} from "./role-intake-experience";

export function RoleIntakeShell({
  children,
  description,
  icon,
  title,
}: {
  children: React.ReactNode;
  description: React.ReactNode;
  icon: React.ReactNode;
  title: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-5 py-14 sm:px-10 sm:py-20">
      <section className="w-full">
        <Link
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          href="/roles/new"
        >
          <NavArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("roleIntake.back")}
        </Link>
        <header className="mt-9 max-w-2xl">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef0e3] text-olive-900">
            {icon}
          </span>
          <h1 className="mt-5 font-display text-4xl font-medium tracking-normal text-ink-950 sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-600">{description}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

export function RoleIntakeProgress({
  intake,
}: {
  intake: RoleIntakeSummary;
}) {
  const { t } = useTranslation();
  const progress = getRoleIntakeProgress(intake.status);
  const steps: RoleIntakeProgressStep[] = ["source", "processing", "review"];
  const currentStatus =
    intake.status === "processing"
      ? t("roleIntake.progress.processing")
      : intake.status === "queued" || intake.status === "quarantined"
        ? t("roleIntake.progress.waiting")
        : t("roleIntake.progress.uploading");

  return (
    <section
      aria-busy="true"
      aria-labelledby="role-intake-progress-title"
      className="mt-10 rounded-[24px] border border-ink-200 bg-white/72 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <RefreshCircle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-olive-800"
        />
        <div className="min-w-0">
          <h2
            className="font-semibold text-ink-900"
            id="role-intake-progress-title"
          >
            {currentStatus}
          </h2>
          <p className="mt-1 truncate text-sm leading-6 text-ink-600">
            {intake.source.displayName}
          </p>
        </div>
      </div>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => {
          const complete = progress.completedSteps.includes(step);
          const active = progress.activeStep === step;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
                complete
                  ? "border-[#dfe7ca] bg-[#f7f9ef] text-olive-950"
                  : active
                    ? "border-ink-300 bg-white text-ink-900"
                    : "border-ink-100 bg-[#fbfaf6] text-ink-500",
              )}
              key={step}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  complete
                    ? "bg-olive-900 text-white"
                    : active
                      ? "bg-ink-900 text-white"
                      : "bg-ink-100 text-ink-500",
                )}
              >
                {complete ? (
                  <CheckCircle aria-hidden="true" className="h-4 w-4" />
                ) : (
                  index + 1
                )}
              </span>
              {t(`roleIntake.progress.steps.${step}`)}
            </li>
          );
        })}
      </ol>
      <p
        aria-live="polite"
        className="mt-4 text-sm leading-6 text-ink-600"
        role="status"
      >
        {t("roleIntake.progress.autoUpdate")}
      </p>
    </section>
  );
}

export function RoleIntakePrivacyNote({
  retention,
}: {
  retention: RoleIntakeSummary["sourceRetention"];
}) {
  const { t } = useTranslation();
  return (
    <p className="mt-4 text-xs leading-5 text-ink-500">
      {t(`roleIntake.privacy.${retention}`)}
    </p>
  );
}
