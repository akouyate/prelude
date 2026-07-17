"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Link as LinkIcon,
  NavArrowLeft,
  RefreshCircle,
  WarningTriangle,
} from "iconoir-react";

import type { RoleIntakeSummary } from "@prelude/contracts";
import { Button, Field, Input, Notice, cn } from "@prelude/ui";

import {
  consumeRoleIntakeAction,
  createRoleIntakeUrlAction,
  getRoleIntakeSummaryAction,
  saveRoleIntakeReviewAction,
} from "../../server/role-intakes/role-intake-actions";
import {
  RoleIntakeReview,
  toRoleIntakeReviewDraft,
} from "./role-intake-review";

const inFlightStatuses = new Set(["queued", "processing"]);

export function RoleIntakeUrlFlow({
  initialIntake,
}: {
  initialIntake?: RoleIntakeSummary;
}) {
  const router = useRouter();
  const [source, setSource] = React.useState("");
  const [intake, setIntake] = React.useState(initialIntake);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isCreatingRole, setIsCreatingRole] = React.useState(false);
  const [review, setReview] = React.useState(() => toRoleIntakeReviewDraft(initialIntake));

  React.useEffect(() => {
    setReview(toRoleIntakeReviewDraft(intake));
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
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [intake]);

  const importUrl = async () => {
    if (!source.trim()) {
      setError("Enter a public HTTPS job URL.");
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

  const createRole = async () => {
    if (!intake) {
      return;
    }
    setError(null);
    setIsCreatingRole(true);
    try {
      const saved = await saveRoleIntakeReviewAction({
        expectedReviewVersion: intake.reviewVersion,
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
        intake={intake}
        isCreatingRole={isCreatingRole}
        onCreateRole={createRole}
        onReviewChange={setReview}
        review={review}
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
            <LinkIcon aria-hidden="true" className="h-6 w-6" />
          </span>
          <h1 className="mt-5 font-display text-4xl font-medium tracking-normal text-ink-950">
            Import a public job URL
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-ink-600">
            Prelude reads one public HTML job page, checks the site policy, and lets you verify every extracted field.
          </p>
        </div>

        {intake ? (
          <RoleIntakeUrlProgress intake={intake} />
        ) : (
          <div className="mt-10 space-y-4">
            <Field label="Public job URL" description="HTTPS only. LinkedIn and Indeed are not supported here.">
              <Input
                autoComplete="url"
                onChange={(event) => setSource(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void importUrl();
                  }
                }}
                placeholder="https://careers.example.com/jobs/product-designer"
                type="url"
                value={source}
              />
            </Field>
            <Button disabled={isSubmitting} onClick={importUrl}>
              {isSubmitting ? "Preparing import..." : "Import job page"}
            </Button>
          </div>
        )}

        {error ? <Notice className="mt-5" tone="danger">{error}</Notice> : null}
        {intake?.status === "failed" ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={() => setIntake(undefined)} variant="secondary">
              Try another URL
            </Button>
            <Button onClick={() => router.push("/roles/new?source=manual")}>Start manually</Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function RoleIntakeUrlProgress({ intake }: { intake: RoleIntakeSummary }) {
  const failed = intake.status === "failed";
  return (
    <div className="mt-10 rounded-3xl border border-ink-200 bg-[#fbfaf6] p-5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 text-olive-800", failed && "text-coral-700")}>
          {failed ? (
            <WarningTriangle aria-hidden="true" className="h-5 w-5" />
          ) : (
            <RefreshCircle aria-hidden="true" className="h-5 w-5 animate-spin" />
          )}
        </span>
        <div>
          <p className="font-semibold text-ink-900">
            {failed ? "This job page needs another route" : "Checking the public job page"}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-600">{intake.source.displayName}</p>
          <p className="mt-2 text-sm leading-6 text-ink-600">
            {failed
              ? intake.failureMessage ??
                "No role was created. You can use another public URL or enter the role details manually."
              : "Prelude is checking source policy and extracting static job details. This page updates automatically."}
          </p>
        </div>
      </div>
    </div>
  );
}
