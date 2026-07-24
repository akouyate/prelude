"use client";

import * as React from "react";
import {
  CheckCircle,
  Link as LinkIcon,
  Page,
  ShieldCheck,
  WarningTriangle,
} from "iconoir-react";
import { useTranslation } from "react-i18next";

import type { RoleIntakeSummary } from "@prelude/contracts";
import {
  Button,
  Field,
  Input,
  Notice,
  Textarea,
} from "@prelude/ui";

import {
  getRoleIntakeReviewIssues,
  type RoleIntakeReviewDraft,
} from "./role-intake-experience";
import {
  RoleIntakePrivacyNote,
  RoleIntakeShell,
} from "./role-intake-layout";

export type { RoleIntakeReviewDraft } from "./role-intake-experience";

export function RoleIntakeReview({
  error,
  intake,
  isCreatingRole,
  onCreateRole,
  onReviewChange,
  review,
}: {
  error: string | null;
  intake: RoleIntakeSummary;
  isCreatingRole: boolean;
  onCreateRole: () => void;
  onReviewChange: React.Dispatch<React.SetStateAction<RoleIntakeReviewDraft>>;
  review: RoleIntakeReviewDraft;
}) {
  const { t } = useTranslation();
  const isUrl = intake.sourceKind === "url";
  const [showValidation, setShowValidation] = React.useState(false);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null);
  const issues = getRoleIntakeReviewIssues(review);
  const titleInvalid = showValidation && issues.includes("title");
  const descriptionInvalid =
    showValidation && issues.includes("description");

  return (
    <RoleIntakeShell
      description={
        isUrl
          ? t("roleIntake.review.urlDescription")
          : t("roleIntake.review.fileDescription")
      }
      icon={<CheckCircle aria-hidden="true" className="h-6 w-6" />}
      title={t("roleIntake.review.title")}
    >
      <RoleIntakeSourceDetails intake={intake} />

      {intake.warnings.length ? (
        <Notice className="mt-6" tone="warning">
          <div className="flex items-start gap-2">
            <WarningTriangle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <p className="font-semibold">
                {t("roleIntake.review.warningTitle")}
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {intake.warnings.map((warning) => (
                  <li key={`${warning.code}:${warning.message}`}>
                    {t(`roleIntake.warnings.${warning.code}`, {
                      defaultValue: warning.message,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Notice>
      ) : null}
      {error ? (
        <Notice aria-live="assertive" className="mt-6" role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}

      {showValidation && issues.length ? (
        <Notice
          aria-live="assertive"
          className="mt-6"
          role="alert"
          tone="danger"
        >
          {t("roleIntake.review.validationSummary")}
        </Notice>
      ) : null}

      <form
        className="mt-8"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setShowValidation(true);
          if (issues.includes("title")) {
            titleRef.current?.focus();
            return;
          }
          if (issues.includes("description")) {
            descriptionRef.current?.focus();
            return;
          }
          onCreateRole();
        }}
      >
        <section className="space-y-6 rounded-[24px] border border-ink-200 bg-white/72 p-5 sm:p-7">
          <Field
            description={
              titleInvalid ? t("roleIntake.review.requiredError") : undefined
            }
            invalid={titleInvalid}
            label={t("roleIntake.review.roleTitle")}
            labelAddon={t("roleIntake.review.required")}
          >
            <Input
              aria-invalid={titleInvalid}
              onChange={(event) =>
                onReviewChange((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              maxLength={160}
              placeholder={t("roleIntake.review.roleTitlePlaceholder")}
              ref={titleRef}
              value={review.title}
            />
          </Field>
          <Field
            label={t("roleIntake.review.location")}
            labelAddon={t("roleIntake.review.optional")}
          >
            <Input
              onChange={(event) =>
                onReviewChange((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              maxLength={160}
              placeholder={t("roleIntake.review.locationPlaceholder")}
              value={review.location}
            />
          </Field>
          <Field
            description={
              descriptionInvalid
                ? t("roleIntake.review.requiredError")
                : t("roleIntake.review.descriptionHint")
            }
            invalid={descriptionInvalid}
            label={t("roleIntake.review.jobDescription")}
            labelAddon={t("roleIntake.review.required")}
          >
            <Textarea
              aria-invalid={descriptionInvalid}
              className="min-h-72"
              onChange={(event) =>
                onReviewChange((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              maxLength={500_000}
              placeholder={t(
                "roleIntake.review.jobDescriptionPlaceholder",
              )}
              ref={descriptionRef}
              value={review.description}
            />
          </Field>
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-5 border-t border-ink-200 pt-6">
          <div className="flex max-w-lg items-start gap-2 text-sm leading-6 text-ink-600">
            <ShieldCheck
              aria-hidden="true"
              className="mt-1 h-4 w-4 shrink-0 text-olive-800"
            />
            <p>{t("roleIntake.review.confirmation")}</p>
          </div>
          <Button disabled={isCreatingRole} type="submit">
            {isCreatingRole
              ? t("roleIntake.review.creating")
              : t("roleIntake.review.continue")}
          </Button>
        </div>
      </form>
    </RoleIntakeShell>
  );
}

export function toRoleIntakeReviewDraft(intake?: RoleIntakeSummary): RoleIntakeReviewDraft {
  return {
    description: intake?.reviewedDraft.description ?? "",
    location: intake?.reviewedDraft.location ?? "",
    title: intake?.reviewedDraft.title ?? "",
  };
}

function RoleIntakeSourceDetails({ intake }: { intake: RoleIntakeSummary }) {
  const { t } = useTranslation();
  const isUrl = intake.sourceKind === "url";
  const fields = intake.source.fieldSources;
  return (
    <section className="mt-8 rounded-[20px] border border-ink-200 bg-[#fbfaf6] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eef0e3] text-olive-900">
          {isUrl ? (
            <LinkIcon aria-hidden="true" className="h-4.5 w-4.5" />
          ) : (
            <Page aria-hidden="true" className="h-4.5 w-4.5" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">
            {isUrl
              ? t("roleIntake.review.publicSource")
              : t("roleIntake.review.uploadedSource")}
          </p>
          <p className="mt-0.5 break-all text-sm leading-6 text-ink-600">
            {isUrl
              ? intake.source.canonicalUrl ??
                intake.source.submittedUrl ??
                intake.source.displayName
              : intake.source.displayName}
          </p>
          {isUrl && fields ? (
            <p className="mt-2 text-xs leading-5 text-ink-500">
              {t("roleIntake.review.sourceDetails", {
                description: formatFieldSource(fields.description, t),
                location: formatFieldSource(fields.location, t),
                title: formatFieldSource(fields.title, t),
              })}
            </p>
          ) : null}
          <RoleIntakePrivacyNote retention={intake.sourceRetention} />
        </div>
      </div>
    </section>
  );
}

function formatFieldSource(
  source: NonNullable<
    RoleIntakeSummary["source"]["fieldSources"]
  >["title"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return {
    heading: t("roleIntake.review.fieldSources.heading"),
    job_posting_json_ld: t(
      "roleIntake.review.fieldSources.jobPostingData",
    ),
    main_content: t("roleIntake.review.fieldSources.visiblePage"),
    page_title: t("roleIntake.review.fieldSources.pageTitle"),
    unavailable: t("roleIntake.review.fieldSources.notFound"),
  }[source];
}
