"use client";

import { ArrowRight } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { decisionCtaClassName } from "./candidate-decision-bar";
import { ScheduleCallDialog } from "./schedule-call-dialog";

// Client boundary for the decision bar's call-to-action: the scheduling dialog
// needs a render-prop trigger, which cannot cross the server/client edge.
export function CandidateScheduleCta(
  props: Omit<React.ComponentProps<typeof ScheduleCallDialog>, "renderTrigger">,
) {
  const { t } = useTranslation();

  return (
    <ScheduleCallDialog
      {...props}
      renderTrigger={({ disabled, open }) => (
        <button
          className={decisionCtaClassName}
          disabled={disabled}
          onClick={open}
          type="button"
        >
          {t("candidateReview.scheduleCall")}
          <ArrowRight aria-hidden={true} className="h-[15px] w-[15px]" />
        </button>
      )}
    />
  );
}
