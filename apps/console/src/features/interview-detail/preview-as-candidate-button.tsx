"use client";

import * as React from "react";
import { Eye } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { createCandidateExperiencePreview } from "../../server/interviews/candidate-experience-previews";

/*
 * Previewing is not the same as opening the candidate link. The candidate link
 * carries an invitation, so once that invitation is completed (or expired) the
 * candidate app rightly refuses it — the recruiter would land on "Interview
 * completed". A preview mints its own short-lived token instead, which is why
 * this goes through createCandidateExperiencePreview like the builder does.
 * Navigation stays in the same tab: the preview screen carries an "Exit
 * preview" link back to this page.
 */
export function PreviewAsCandidateButton({ draftId }: { draftId: string }) {
  const { t } = useTranslation();
  const [isOpening, setIsOpening] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openPreview = React.useCallback(async () => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    setError(null);
    try {
      const result = await createCandidateExperiencePreview(draftId);
      if (!result.ok) {
        setError(result.error);
        setIsOpening(false);
        return;
      }

      window.location.assign(result.previewUrl);
    } catch {
      setError(t("interviewDetail.previewAsCandidateError"));
      setIsOpening(false);
    }
  }, [draftId, isOpening, t]);

  return (
    <>
      <button
        className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-4 text-[13px] font-semibold text-ink-950 transition hover:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isOpening}
        onClick={() => {
          void openPreview();
        }}
        type="button"
      >
        <Eye aria-hidden={true} className="h-4 w-4" />
        {isOpening
          ? t("interviewDetail.previewAsCandidateOpening")
          : t("interviewDetail.previewAsCandidate")}
      </button>
      {error ? (
        <p
          className="w-full text-right text-[12px] text-coral-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
