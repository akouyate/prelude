"use client";

import * as React from "react";
import { ArrowRight, Calendar } from "iconoir-react";
import { useTranslation } from "react-i18next";

import {
  decisionChipClassName,
  decisionCtaClassName,
} from "./candidate-decision-bar";
import { ScheduleCallDialog } from "./schedule-call-dialog";
import {
  formatCompactCallLabel,
  resolveScheduleTrigger,
  scheduledCallBannerId,
} from "./scheduled-call-presentation";

// Client boundary for the decision bar's action slot: the scheduling dialog
// needs a render-prop trigger, which cannot cross the server/client edge.
export function CandidateScheduleCta(
  props: Omit<React.ComponentProps<typeof ScheduleCallDialog>, "renderTrigger">,
) {
  const { i18n, t } = useTranslation();
  const trigger = resolveScheduleTrigger(props.scheduledCall);

  /*
   * Booked: a chip, and only a chip — and it still does not reopen the dialog,
   * now that the dialog can move a call. Moving it lives on the banner, beside
   * the links that say where the call is: one surface owns the booked call, and
   * a second trigger down here would be a second way to do the same thing from
   * a bar whose job is advance / hold / pass.
   *
   * What the chip is genuinely good for is the distance it closes: the bar is
   * fixed to the bottom of a long candidate page and the call's details sit in
   * a banner at the very top. So the chip carries the recruiter there — to the
   * Reschedule action included — and the dialog is not mounted at all here.
   */
  if (trigger.kind === "booked") {
    return (
      <ScheduledCallChip
        label={
          formatCompactCallLabel({
            locale: i18n.language,
            startsAt: trigger.startsAt,
            timeZone: trigger.timeZone,
          }) ?? t("candidateReview.scheduledCallChipFallback")
        }
      />
    );
  }

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

/*
 * A real in-page anchor, then enhanced. Plain `href="#…"` already scrolls to
 * the banner AND focuses it (the banner carries `tabIndex={-1}`), so the chip
 * works with no JavaScript and survives a middle-click. The handler only adds
 * what markup cannot express: a smooth glide instead of a jump, centred rather
 * than jammed under the page chrome, and no `#` left in the URL.
 */
function ScheduledCallChip({ label }: { label: string }) {
  const { t } = useTranslation();

  const anchorToBanner = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const banner = document.getElementById(scheduledCallBannerId);
    if (!banner) {
      // Nothing to enhance — let the browser follow the href and do its best.
      return;
    }

    event.preventDefault();
    // Focus first, and with `preventScroll`, so the scroll request below is the
    // last word on where the viewport ends up — a focus that scrolls on its own
    // would fight the glide, and one issued afterwards risks cancelling it.
    banner.focus({ preventScroll: true });
    banner.scrollIntoView({
      // The console's reduced-motion grain is the `motion-reduce:` variant;
      // a scroll the browser owns can only be asked for in JS, so it is asked
      // for here. Reduced motion gets the same landing without the glide.
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
  };

  return (
    <a
      aria-label={t("candidateReview.scheduledCallChipAria", { date: label })}
      className={decisionChipClassName}
      href={`#${scheduledCallBannerId}`}
      onClick={anchorToBanner}
      title={t("candidateReview.scheduledCallChipHint")}
    >
      <Calendar aria-hidden={true} className="h-[14px] w-[14px]" />
      {label}
    </a>
  );
}
