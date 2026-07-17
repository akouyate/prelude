"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Attachment,
  CheckCircle,
  NavArrowLeft,
  RefreshCircle,
  WarningTriangle,
} from "iconoir-react";

import {
  Button,
  Field,
  Input,
  Notice,
  Textarea,
  cn,
} from "@prelude/ui";
import type { RoleIntakeSummary } from "@prelude/contracts";

import {
  consumeRoleIntakeAction,
  createRoleIntakeUploadAction,
  finalizeRoleIntakeUploadAction,
  getRoleIntakeSummaryAction,
  saveRoleIntakeReviewAction,
} from "../../server/role-intakes/role-intake-actions";

const inFlightStatuses = new Set(["uploading", "quarantined", "queued", "processing"]);

export function RoleIntakeUploadFlow({
  initialIntake,
}: {
  initialIntake?: RoleIntakeSummary;
}) {
  const router = useRouter();
  const [intake, setIntake] = React.useState(initialIntake);
  const [error, setError] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isCreatingRole, setIsCreatingRole] = React.useState(false);
  const [review, setReview] = React.useState(() => toReviewDraft(initialIntake));
  const resumeIntakeId = intake?.duplicateOfIntakeId;

  React.useEffect(() => {
    setReview(toReviewDraft(intake));
  }, [intake?.id]);

  React.useEffect(() => {
    if (!intake || !inFlightStatuses.has(intake.status)) {
      return;
    }
    const timer = window.setInterval(async () => {
      const result = await getRoleIntakeSummaryAction(intake.id);
      if (result.ok) {
        setIntake(result.value);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [intake]);

  const upload = async (file: File) => {
    setError(null);
    setIsUploading(true);
    try {
      const created = await createRoleIntakeUploadAction({
        byteSize: file.size,
        contentType: file.type,
        fileName: file.name,
      });
      if (!created.ok) {
        setError(created.error);
        return;
      }

      const response = await fetch(created.value.uploadUrl, {
        body: file,
        headers: { "content-type": file.type },
        method: "PUT",
      });
      if (!response.ok) {
        setError("The private upload did not finish. Please choose the file again.");
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
      setError("The private upload did not finish. Please choose the file again.");
    } finally {
      setIsUploading(false);
    }
  };

  const createRole = async () => {
    if (!intake) {
      return;
    }
    setError(null);
    setIsCreatingRole(true);
    try {
      const saved = await saveRoleIntakeReviewAction({
        intakeId: intake.id,
        reviewedDraft: review,
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      const consumed = await consumeRoleIntakeAction(intake.id);
      if (!consumed.ok) {
        setError(consumed.error);
        return;
      }
      router.push(`/roles/new?jobId=${encodeURIComponent(consumed.value.jobId)}`);
    } finally {
      setIsCreatingRole(false);
    }
  };

  if (intake?.status === "ready_for_review") {
    return (
      <RoleIntakeReview
        error={error}
        isCreatingRole={isCreatingRole}
        onCreateRole={createRole}
        onReviewChange={setReview}
        review={review}
        warnings={intake.warnings}
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-20 sm:px-10">
      <section className="w-full rounded-[32px] border border-ink-200 bg-white/82 p-6 sm:p-10">
        <Link
          className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          href="/roles/new"
        >
          <NavArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back
        </Link>
        <div className="mt-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef0e3] text-olive-900">
            <Attachment aria-hidden="true" className="h-6 w-6" />
          </span>
          <h1 className="mt-5 font-display text-4xl font-medium tracking-normal text-ink-950">
            Import a role brief
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-ink-600">
            Upload a PDF or DOCX. Prelude checks it privately, extracts text, and lets you verify the role before it becomes visible.
          </p>
        </div>

        {intake ? (
          <RoleIntakeProgress intake={intake} />
        ) : (
          <label
            className={cn(
              "mt-10 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-ink-300 bg-[#fbfaf6] px-6 text-center transition",
              "hover:border-ink-900 hover:bg-white focus-within:border-ink-900 focus-within:ring-2 focus-within:ring-olive-300",
              isUploading && "pointer-events-none opacity-60",
            )}
          >
            <Attachment aria-hidden="true" className="h-7 w-7 text-ink-700" />
            <span className="mt-4 text-base font-semibold text-ink-900">
              {isUploading ? "Preparing private upload..." : "Choose a PDF or DOCX"}
            </span>
            <span className="mt-2 text-sm text-ink-600">Up to 10 MB. Text documents only.</span>
            <input
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void upload(file);
                }
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
        )}

        {error ? <Notice className="mt-5" tone="danger">{error}</Notice> : null}
        {intake?.status === "failed" ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {resumeIntakeId ? (
              <Button
                onClick={() =>
                  router.push(
                    `/roles/new?source=upload&intakeId=${encodeURIComponent(resumeIntakeId)}`,
                  )
                }
                variant="secondary"
              >
                Resume existing import
              </Button>
            ) : null}
            <Button onClick={() => setIntake(undefined)} variant="secondary">
              Choose another file
            </Button>
            <Button onClick={() => router.push("/roles/new?source=manual")}>Start manually</Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RoleIntakeProgress({ intake }: { intake: RoleIntakeSummary }) {
  const isFailed = intake.status === "failed";
  const resumeIntakeId = intake.duplicateOfIntakeId;
  const icon = isFailed ? (
    <WarningTriangle aria-hidden="true" className="h-5 w-5" />
  ) : (
    <RefreshCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
  );
  const title = isFailed
    ? resumeIntakeId
      ? "An existing import is available"
      : "This document needs another try"
    : "Checking your role brief";
  const copy = isFailed
    ? resumeIntakeId
      ? "This exact document already has a private intake. Resume it instead of creating a duplicate role."
      : "No role was created. The original file has been removed from private staging."
    : "Prelude is checking the file and extracting only the role details. This page updates automatically.";

  return (
    <div className="mt-10 rounded-3xl border border-ink-200 bg-[#fbfaf6] p-5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 text-olive-800", isFailed && "text-coral-700")}>{icon}</span>
        <div>
          <p className="font-semibold text-ink-900">{title}</p>
          <p className="mt-1 text-sm leading-6 text-ink-600">{intake.originalFileName}</p>
          <p className="mt-2 text-sm leading-6 text-ink-600">{copy}</p>
        </div>
      </div>
    </div>
  );
}

function RoleIntakeReview({
  error,
  isCreatingRole,
  onCreateRole,
  onReviewChange,
  review,
  warnings,
}: {
  error: string | null;
  isCreatingRole: boolean;
  onCreateRole: () => void;
  onReviewChange: React.Dispatch<React.SetStateAction<ReviewDraft>>;
  review: ReviewDraft;
  warnings: RoleIntakeSummary["warnings"];
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-14 sm:px-10">
      <Link
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
        href="/roles/new"
      >
        <NavArrowLeft aria-hidden="true" className="h-4 w-4" />
        Start over
      </Link>
      <header className="mt-10">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef0e3] text-olive-900">
          <CheckCircle aria-hidden="true" className="h-6 w-6" />
        </span>
        <h1 className="mt-5 font-display text-4xl font-medium tracking-normal text-ink-950">
          Review the role details
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-ink-600">
          Prelude extracted the text without changing it. Confirm the details below before drafting interview questions.
        </p>
      </header>

      {warnings.length ? (
        <Notice className="mt-7" tone="warning">
          {warnings.map((warning) => warning.message).join(" ")}
        </Notice>
      ) : null}
      {error ? <Notice className="mt-7" tone="danger">{error}</Notice> : null}

      <section className="mt-8 space-y-6 rounded-[32px] border border-ink-200 bg-white/82 p-6 sm:p-8">
        <Field label="Role title">
          <Input
            onChange={(event) => onReviewChange((current) => ({ ...current, title: event.target.value }))}
            placeholder="e.g. Customer Success Manager"
            value={review.title}
          />
        </Field>
        <Field label="Location" description="Optional">
          <Input
            onChange={(event) => onReviewChange((current) => ({ ...current, location: event.target.value }))}
            placeholder="e.g. Paris or remote"
            value={review.location}
          />
        </Field>
        <Field label="Job description">
          <Textarea
            onChange={(event) => onReviewChange((current) => ({ ...current, description: event.target.value }))}
            placeholder="Describe the role, responsibilities, and the context candidates should know."
            value={review.description}
          />
        </Field>
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-ink-200 pt-6">
        <p className="max-w-md text-sm leading-6 text-ink-600">
          The original file is already removed after extraction. Only these reviewed role details continue to the builder.
        </p>
        <Button disabled={isCreatingRole || !review.title.trim() || !review.description.trim()} onClick={onCreateRole}>
          {isCreatingRole ? "Creating role..." : "Continue to questions"}
        </Button>
      </div>
    </main>
  );
}

type ReviewDraft = {
  description: string;
  location: string;
  title: string;
};

function toReviewDraft(intake?: RoleIntakeSummary): ReviewDraft {
  return {
    description: intake?.reviewedDraft.description ?? "",
    location: intake?.reviewedDraft.location ?? "",
    title: intake?.reviewedDraft.title ?? "",
  };
}
