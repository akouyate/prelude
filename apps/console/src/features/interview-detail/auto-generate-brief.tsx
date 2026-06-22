"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Card } from "@prelude/ui";
import { Sparks } from "iconoir-react";

import { generateCandidateBriefAction } from "../../server/interviews/candidate-brief-actions";

/**
 * #5 — auto-generate the recruiter brief on view. The page renders this ONLY when
 * the runtime evidence is ready and no usable brief exists yet (see
 * shouldAutoGenerateBrief). It fires the existing, validated generate action
 * exactly once on mount, shows a progress card, then refreshes so the real brief
 * renders. The action is idempotent and evidence-gated; the once-guard plus the
 * eligibility rule keep this from looping.
 */
export function AutoGenerateBrief({
  detailPath,
  sessionId,
}: {
  detailPath: string;
  sessionId: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;

    const formData = new FormData();
    formData.set("candidateSessionId", sessionId);
    formData.set("detailPath", detailPath);

    void generateCandidateBriefAction(formData).then(() => {
      router.refresh();
    });
  }, [detailPath, router, sessionId]);

  return (
    <Card className="bg-[#f7f7ef] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-950">
        <Sparks aria-hidden="true" className="h-4 w-4 animate-pulse" />
        {t("interviewDetail.briefAutoGenerating")}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">
        {t("interviewDetail.briefAutoGeneratingBody")}
      </p>
    </Card>
  );
}
