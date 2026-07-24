"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Attachment, WarningTriangle } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { Button, Notice } from "@prelude/ui";
import type { RoleIntakeSummary } from "@prelude/contracts";

import {
  createRoleIntakeUploadAction,
  finalizeRoleIntakeUploadAction,
} from "../../server/role-intakes/role-intake-actions";
import {
  classifyRoleIntakeFailure,
  resolveRoleIntakeContentType,
  validateRoleIntakeSelection,
} from "./role-intake-experience";
import { RoleIntakeDropzone } from "./role-intake-dropzone";
import {
  RoleIntakePrivacyNote,
  RoleIntakeProgress,
  RoleIntakeShell,
} from "./role-intake-layout";
import { RoleIntakeReview } from "./role-intake-review";
import { useRoleIntakeFlow } from "./use-role-intake-flow";

export function RoleIntakeUploadFlow({
  initialIntake,
}: {
  initialIntake?: RoleIntakeSummary;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = React.useState(false);
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

  const upload = async (file: File) => {
    setError(null);
    const contentType =
      resolveRoleIntakeContentType(file.name, file.type) ?? file.type;
    const issue = validateRoleIntakeSelection({
      byteSize: file.size,
      contentType,
      fileName: file.name,
    });
    if (issue) {
      setError(t(`roleIntake.upload.errors.${issue}`));
      return;
    }
    setIsUploading(true);
    try {
      const created = await createRoleIntakeUploadAction({
        byteSize: file.size,
        contentType,
        fileName: file.name,
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setIntake(created.value.intake);

      const response = await fetch(created.value.uploadUrl, {
        body: file,
        headers: { "content-type": contentType },
        method: "PUT",
      });
      if (!response.ok) {
        setIntake(undefined);
        setError(t("roleIntake.upload.errors.uploadFailed"));
        return;
      }

      const finalized = await finalizeRoleIntakeUploadAction(created.value.intake.id);
      if (!finalized.ok) {
        setError(finalized.error);
        return;
      }
      setIntake(finalized.value);
      router.replace(`/roles/new?source=upload&intakeId=${encodeURIComponent(finalized.value.id)}`);
    } catch {
      setIntake(undefined);
      setError(t("roleIntake.upload.errors.uploadFailed"));
    } finally {
      setIsUploading(false);
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
      description={t("roleIntake.upload.description")}
      icon={<Attachment aria-hidden="true" className="h-6 w-6" />}
      title={t("roleIntake.upload.title")}
    >
      {!intake ? (
        <RoleIntakeDropzone
          disabled={isUploading}
          onSelect={(file) => void upload(file)}
        />
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
          <div className="mt-5 flex flex-wrap gap-3">
            {failureAction === "resume" && intake.duplicateOfIntakeId ? (
              <Button
                onClick={() =>
                  router.push(
                    `/roles/new?source=upload&intakeId=${encodeURIComponent(intake.duplicateOfIntakeId!)}`,
                  )
                }
              >
                {t("roleIntake.failure.resume.action")}
              </Button>
            ) : null}
            <Button onClick={() => setIntake(undefined)} variant="secondary">
              {t("roleIntake.failure.chooseAnother")}
            </Button>
            <Button onClick={() => void startManually()}>
              {t("roleIntake.failure.startManual")}
            </Button>
          </div>
        </section>
      ) : (
        <RoleIntakeProgress intake={intake} />
      )}
      {intake ? (
        <RoleIntakePrivacyNote retention={intake.sourceRetention} />
      ) : (
        <RoleIntakePrivacyNote retention="pending_deletion" />
      )}
      {error ? (
        <Notice aria-live="assertive" className="mt-5" role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
    </RoleIntakeShell>
  );
}
