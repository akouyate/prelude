"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import type { RoleIntakeSummary } from "@prelude/contracts";

import {
  consumeRoleIntakeAction,
  getRoleIntakeSummaryAction,
  recordRoleIntakeManualFallbackAction,
  saveRoleIntakeReviewAction,
} from "../../server/role-intakes/role-intake-actions";
import { toRoleIntakeReviewDraft } from "./role-intake-review";
import type { RoleIntakeReviewDraft } from "./role-intake-experience";

const inFlightStatuses = new Set([
  "uploading",
  "quarantined",
  "queued",
  "processing",
]);

export function useRoleIntakeFlow(initialIntake?: RoleIntakeSummary) {
  const router = useRouter();
  const [intake, setIntake] = React.useState(initialIntake);
  const [error, setError] = React.useState<string | null>(null);
  const [isCreatingRole, setIsCreatingRole] = React.useState(false);
  const [review, setReview] = React.useState<RoleIntakeReviewDraft>(() =>
    toRoleIntakeReviewDraft(initialIntake),
  );

  React.useEffect(() => {
    if (intake?.status === "ready_for_review") {
      setReview(toRoleIntakeReviewDraft(intake));
    }
  }, [intake?.id, intake?.reviewVersion, intake?.status]);

  React.useEffect(() => {
    if (!intake || !inFlightStatuses.has(intake.status)) {
      return;
    }

    let cancelled = false;
    let failureCount = 0;
    const poll = async () => {
      const result = await getRoleIntakeSummaryAction(intake.id);
      if (cancelled) {
        return;
      }
      if (result.ok) {
        failureCount = 0;
        setError(null);
        setIntake(result.value);
        return;
      }
      failureCount += 1;
      if (failureCount >= 3) {
        setError(result.error);
      }
    };
    const timer = window.setInterval(() => void poll(), 1_500);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intake?.id, intake?.status]);

  const createRole = React.useCallback(async () => {
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
      setIntake(saved.value);
      const consumed = await consumeRoleIntakeAction(intake.id);
      if (!consumed.ok) {
        setError(consumed.error);
        return;
      }
      router.push(
        `/roles/new?jobId=${encodeURIComponent(consumed.value.jobId)}`,
      );
    } finally {
      setIsCreatingRole(false);
    }
  }, [intake, review, router]);

  const startManually = React.useCallback(async () => {
    if (intake) {
      await recordRoleIntakeManualFallbackAction(intake.id);
    }
    const params = new URLSearchParams({ source: "manual" });
    if (intake?.source.submittedUrl) {
      params.set("sourceUrl", intake.source.submittedUrl);
    }
    router.push(`/roles/new?${params.toString()}`);
  }, [intake, router]);

  return {
    createRole,
    error,
    intake,
    isCreatingRole,
    review,
    setError,
    setIntake,
    setReview,
    startManually,
  };
}
