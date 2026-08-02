"use client";

import Link from "next/link";
import { Attachment, EditPencil, Plus } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { cn } from "@prelude/ui";

import { IntegrationLogo } from "../integrations/integration-logo";
import { roleIntakeUrlBrands } from "./role-intake-url-brand";
export function RoleIntakeSourcePicker({
  importEnabled,
}: {
  importEnabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-20 sm:px-10">
      <section className="w-full">
        <p className="text-sm font-medium text-ink-500">
          {t("roleIntake.source.eyebrow")}
        </p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl font-medium tracking-normal text-ink-950 sm:text-5xl">
          {t("roleIntake.source.title")}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-ink-600">
          {t("roleIntake.source.description")}
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <SourceLink
            description={t("roleIntake.source.manualDescription")}
            href="/roles/new?source=manual"
            icon={<EditPencil aria-hidden="true" className="h-6 w-6" />}
            meta={t("roleIntake.source.manualMeta")}
            title={t("roleIntake.source.manualTitle")}
          />
          {importEnabled ? (
            <>
              <SourceLink
                description={t("roleIntake.source.uploadDescription")}
                href="/roles/new?source=upload"
                icon={<Attachment aria-hidden="true" className="h-6 w-6" />}
                meta={t("roleIntake.source.uploadMeta")}
                title={t("roleIntake.source.uploadTitle")}
              />
              <SourceLink
                description={t("roleIntake.source.urlDescription")}
                href="/roles/new?source=url"
                meta={t("roleIntake.source.urlMeta")}
                title={t("roleIntake.source.urlTitle")}
                visual={
                  <JobLinkSources
                    label={t("roleIntake.source.urlSupportedSources")}
                    moreLabel={t("roleIntake.source.urlMoreSources")}
                  />
                }
              />
            </>
          ) : (
            <div
              aria-disabled="true"
              className="relative flex min-h-56 cursor-not-allowed flex-col rounded-[24px] border border-ink-200 bg-white/45 p-6 opacity-70 md:col-span-2"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-200 bg-[#f7f6f1] text-ink-700">
                <Attachment aria-hidden="true" className="h-6 w-6" />
              </span>
              <h2 className="mt-auto text-xl font-semibold text-ink-900">
                {t("roleIntake.source.unavailableTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-600">
                {t("roleIntake.source.unavailableDescription")}
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function SourceLink({
  description,
  href,
  icon,
  meta,
  title,
  visual,
}: {
  description: string;
  href: string;
  icon?: React.ReactNode;
  meta: string;
  title: string;
  visual?: React.ReactNode;
}) {
  return (
    <Link
      className={cn(
        "group relative flex min-h-56 cursor-pointer flex-col rounded-[24px] border border-ink-200 bg-white/72 p-6 transition-colors",
        "hover:border-ink-900 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300",
      )}
      href={href}
    >
      {visual ?? (
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-ink-200 bg-[#f7f6f1] text-ink-900 transition group-hover:border-olive-200 group-hover:bg-[#f2f4e9]">
          {icon}
        </span>
      )}
      <span className="mt-5 text-xs font-medium uppercase text-olive-800">
        {meta}
      </span>
      <h2 className="mt-auto text-xl font-semibold text-ink-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
    </Link>
  );
}

function JobLinkSources({
  label,
  moreLabel,
}: {
  label: string;
  moreLabel: string;
}) {
  return (
    <div aria-label={label} className="flex h-12 items-center gap-2" role="img">
      {roleIntakeUrlBrands.map((brand) => (
        <IntegrationLogo
          brand={brand}
          className="h-11 w-11 rounded-[14px] border-ink-200"
          key={brand}
        />
      ))}
      <span
        className="grid h-11 w-11 place-items-center rounded-[14px] border border-ink-200 bg-[#f7f6f1] text-ink-700"
        title={moreLabel}
      >
        <Plus aria-hidden="true" className="h-5 w-5" />
      </span>
    </div>
  );
}
