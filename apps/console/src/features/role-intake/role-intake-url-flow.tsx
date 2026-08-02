"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, Plus, WarningTriangle } from "iconoir-react";
import { useTranslation } from "react-i18next";

import type { RoleIntakeSummary } from "@prelude/contracts";
import { Button, Field, Input, Notice } from "@prelude/ui";

import { IntegrationLogo } from "../integrations/integration-logo";
import {
  createRoleIntakeUrlAction,
} from "../../server/role-intakes/role-intake-actions";
import { classifyRoleIntakeFailure } from "./role-intake-experience";
import {
  RoleIntakePrivacyNote,
  RoleIntakeProgress,
  RoleIntakeShell,
} from "./role-intake-layout";
import { RoleIntakeReview } from "./role-intake-review";
import { useRoleIntakeFlow } from "./use-role-intake-flow";
import {
  detectRoleIntakeUrlBrand,
  roleIntakeUrlBrands,
} from "./role-intake-url-brand";

export function RoleIntakeUrlFlow({
  initialIntake,
}: {
  initialIntake?: RoleIntakeSummary;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [source, setSource] = React.useState("");
  const detectedBrand = React.useMemo(
    () => detectRoleIntakeUrlBrand(source),
    [source],
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const {
    createRole,
    error,
    intake,
    isCreatingRole,
    review,
    setError,
    setIntake,
    setReview,
    startManually,
  } = useRoleIntakeFlow(initialIntake);

  const importUrl = async () => {
    if (!source.trim()) {
      setError(t("roleIntake.url.errors.required"));
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const created = await createRoleIntakeUrlAction(source);
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setIntake(created.value);
      router.replace(`/roles/new?source=url&intakeId=${encodeURIComponent(created.value.id)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (intake?.status === "ready_for_review") {
    return (
      <RoleIntakeReview
        error={error}
        intake={intake}
        isCreatingRole={isCreatingRole}
        onCreateRole={createRole}
        onReviewChange={setReview}
        review={review}
      />
    );
  }

  const failureAction = intake
    ? classifyRoleIntakeFailure(
        intake.failureCode,
        intake.duplicateOfIntakeId,
      )
    : "retry";

  return (
    <RoleIntakeShell
      description={t("roleIntake.url.description")}
      icon={<LinkIcon aria-hidden="true" className="h-6 w-6" />}
      title={t("roleIntake.url.title")}
    >
      {!intake ? (
        <>
          <JobLinkSourceLogos label={t("roleIntake.url.supportedSources")} />
          <form
            className="mt-8 max-w-2xl space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void importUrl();
            }}
          >
            <Field
              description={t("roleIntake.url.hint")}
              label={t("roleIntake.url.label")}
            >
              <div className="relative">
                <Input
                  autoComplete="url"
                  className={detectedBrand ? "pr-14" : undefined}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder={t("roleIntake.url.placeholder")}
                  type="url"
                  value={source}
                />
                {detectedBrand ? (
                  <span
                    aria-label={t("roleIntake.url.detectedSource", {
                      provider: detectedBrand,
                    })}
                    className="absolute inset-y-0 right-2 flex items-center"
                    role="img"
                  >
                    <IntegrationLogo brand={detectedBrand} size="compact" />
                  </span>
                ) : null}
              </div>
            </Field>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting
                ? t("roleIntake.url.preparing")
                : t("roleIntake.url.action")}
            </Button>
          </form>
        </>
      ) : intake.status === "failed" ? (
        <section className="mt-10 rounded-[24px] border border-coral-100 bg-coral-50 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <WarningTriangle
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-coral-700"
            />
            <div>
              <h2 className="font-semibold text-ink-900">
                {t(`roleIntake.failure.${failureAction}.title`)}
              </h2>
              <p className="mt-1 text-sm leading-6 text-ink-600">
                {t(`roleIntake.failure.${failureAction}.description`)}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {failureAction === "resume" && intake.duplicateOfIntakeId ? (
              <Button
                onClick={() =>
                  router.push(
                    `/roles/new?source=url&intakeId=${encodeURIComponent(intake.duplicateOfIntakeId!)}`,
                  )
                }
              >
                {t("roleIntake.failure.resume.action")}
              </Button>
            ) : null}
            <Button onClick={() => setIntake(undefined)} variant="secondary">
              {t(
                failureAction === "retry"
                  ? "roleIntake.failure.retryUrl"
                  : "roleIntake.failure.tryAnotherUrl",
              )}
            </Button>
            <Button onClick={() => void startManually()}>
              {t("roleIntake.failure.startManual")}
            </Button>
          </div>
        </section>
      ) : (
        <RoleIntakeProgress intake={intake} />
      )}
      <RoleIntakePrivacyNote
        retention={intake?.sourceRetention ?? "not_stored"}
      />
      {error ? (
        <Notice aria-live="assertive" className="mt-5" role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
    </RoleIntakeShell>
  );
}

function JobLinkSourceLogos({ label }: { label: string }) {
  const { t } = useTranslation();

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2" role="img" aria-label={label}>
      {roleIntakeUrlBrands.map((brand) => (
        <IntegrationLogo brand={brand} key={brand} size="compact" />
      ))}
      <span
        className="grid h-9 w-9 place-items-center rounded-[11px] border border-ink-200 bg-[#f7f6f1] text-ink-700"
        title={t("roleIntake.source.urlMoreSources")}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
      </span>
    </div>
  );
}
