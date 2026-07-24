"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle,
  NavArrowLeft,
  WarningTriangle,
} from "iconoir-react";

import type { RoleIntakeSummary } from "@prelude/contracts";
import {
  Button,
  Field,
  Input,
  Notice,
  Textarea,
} from "@prelude/ui";

export type RoleIntakeReviewDraft = {
  description: string;
  location: string;
  title: string;
};

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
  const isUrl = intake.sourceKind === "url";

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
          {isUrl
            ? "Prelude extracted the public page without running its scripts. Confirm every field before drafting interview questions."
            : "Prelude extracted the text without changing it. Confirm the details below before drafting interview questions."}
        </p>
      </header>

      <RoleIntakeSourceDetails intake={intake} />

      {intake.warnings.length ? (
        <Notice className="mt-7" tone="warning">
          {intake.warnings.map((warning) => warning.message).join(" ")}
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
          {isUrl
            ? "Only this reviewed role draft continues to the builder. Prelude does not keep or render the remote page."
            : "The original file is already removed after extraction. Only these reviewed role details continue to the builder."}
        </p>
        <Button disabled={isCreatingRole || !review.title.trim() || !review.description.trim()} onClick={onCreateRole}>
          {isCreatingRole ? "Creating role..." : "Continue to questions"}
        </Button>
      </div>
    </main>
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
  if (intake.sourceKind !== "url") {
    return null;
  }
  const fields = intake.source.fieldSources;
  return (
    <section className="mt-8 rounded-3xl border border-ink-200 bg-[#fbfaf6] p-5">
      <div className="flex items-start gap-3">
        <WarningTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 text-olive-800" />
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">Public source</p>
          <p className="mt-1 break-all text-sm leading-6 text-ink-600">
            {intake.source.canonicalUrl ?? intake.source.submittedUrl ?? intake.source.displayName}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            {formatSourceDetails(intake)}
          </p>
          {fields ? (
            <p className="mt-2 text-xs leading-5 text-ink-500">
              Title: {formatFieldSource(fields.title)} · Description: {formatFieldSource(fields.description)} · Location: {formatFieldSource(fields.location)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function formatSourceDetails(intake: RoleIntakeSummary): string {
  const captured = intake.source.fetchedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(intake.source.fetchedAt),
      )
    : "Capture time unavailable";
  return `${intake.source.extractorVersion ?? "Static extraction"} · ${captured}`;
}

function formatFieldSource(source: NonNullable<RoleIntakeSummary["source"]["fieldSources"]>["title"]): string {
  return {
    heading: "page heading",
    job_posting_json_ld: "JobPosting data",
    main_content: "visible page",
    page_title: "page title",
    unavailable: "not found",
  }[source];
}
