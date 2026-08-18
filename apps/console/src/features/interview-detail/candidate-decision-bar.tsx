"use client";

import * as React from "react";
import { ArrowRight, Check, Clock, Xmark } from "iconoir-react";

import type { CandidateReviewStatus } from "../candidate-screens";

type DecisionDefinition = {
  Icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  activeClassName: string;
  idleIconClassName: string;
  label: string;
  value: CandidateReviewStatus;
};

// The floating bar maps the three review states onto the recruiter's decision
// vocabulary: advance / hold / pass.
const decisions: DecisionDefinition[] = [
  {
    activeClassName: "border-[#8bd66f] bg-[#8bd66f] text-[#12291d]",
    Icon: Check,
    idleIconClassName: "text-[#8bd66f]",
    label: "Advance",
    value: "to_call",
  },
  {
    activeClassName: "border-[#e0b257] bg-[#e0b257] text-[#33230a]",
    Icon: Clock,
    idleIconClassName: "text-[#e0b257]",
    label: "Hold",
    value: "to_review",
  },
  {
    activeClassName: "border-[#d99a7f] bg-[#d99a7f] text-[#33170d]",
    Icon: Xmark,
    idleIconClassName: "text-[#d99a7f]",
    label: "Pass",
    value: "archived",
  },
];

export const decisionCtaClassName =
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full bg-white px-[17px] font-title text-[13px] font-semibold text-ink-950 transition hover:bg-[#f1efe8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed max-[680px]:w-full max-[680px]:justify-center";

export function CandidateDecisionBar({
  canManageReview,
  onDecide,
  reviewStatus,
  scheduleAction,
  sessionId,
}: {
  canManageReview: boolean;
  onDecide: (formData: FormData) => Promise<void>;
  reviewStatus: CandidateReviewStatus;
  // Rendered as the call-to-action when the candidate is cleared to call, so the
  // scheduling dialog stays the single owner of that flow.
  scheduleAction: React.ReactNode;
  sessionId: string;
}) {
  return (
    /*
     * On a phone the bar stacks: the three decisions share one row, the
     * call-to-action takes the next. Side by side they needed ~440px and ran
     * 77px outside the bar's own rounded background — the button floated on
     * the page with nothing behind it. Stacking keeps every label readable,
     * which icon-only buttons would not: "hold" and "pass" are not a clock and
     * a cross to anyone who has not been told so.
     */
    <div className="fixed bottom-[22px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[20px] border border-white/10 bg-ink-900/95 py-[11px] pl-[19px] pr-[13px] shadow-[0_16px_44px_rgba(20,18,12,0.30)] backdrop-blur-lg max-[900px]:bottom-[calc(94px+env(safe-area-inset-bottom))] max-[680px]:left-3 max-[680px]:right-3 max-[680px]:translate-x-0 max-[680px]:flex-col max-[680px]:items-stretch max-[680px]:gap-2 max-[680px]:px-3 max-[680px]:py-2.5">
      <span className="font-title text-xs font-semibold whitespace-nowrap text-white/50 max-[680px]:hidden">
        Decision
      </span>
      <form
        action={onDecide}
        className="flex items-center gap-[7px] max-[680px]:justify-between"
      >
        <input name="candidateSessionId" type="hidden" value={sessionId} />
        {decisions.map((decision) => {
          const on = decision.value === reviewStatus;

          return (
            <button
              aria-pressed={on}
              className={`inline-flex h-9 shrink-0 cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-full border-[1.5px] px-[15px] font-title text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-60 max-[680px]:flex-1 max-[680px]:justify-center max-[680px]:px-2 ${
                on
                  ? decision.activeClassName
                  : "border-white/25 bg-transparent text-white/80 hover:border-white/40"
              }`}
              disabled={!canManageReview}
              key={decision.value}
              name="reviewStatus"
              type="submit"
              value={decision.value}
            >
              <decision.Icon
                aria-hidden={true}
                className={`h-3.5 w-3.5 ${on ? "" : decision.idleIconClassName}`}
              />
              {decision.label}
            </button>
          );
        })}
      </form>
      <span className="h-[26px] w-px bg-white/10 max-[680px]:hidden" />
      {reviewStatus === "to_call" ? (
        scheduleAction
      ) : (
        // Scheduling is the only follow-through the console owns today, so the
        // call-to-action stays dimmed until the candidate is cleared to call.
        <button
          className={`${decisionCtaClassName} opacity-55`}
          disabled
          title="Move the candidate to Advance to schedule the call."
          type="button"
        >
          Schedule call
          <ArrowRight aria-hidden={true} className="h-[15px] w-[15px]" />
        </button>
      )}
    </div>
  );
}
