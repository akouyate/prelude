"use client";

import type * as React from "react";
import { Calendar } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { ScheduleCallDialog, ScheduledCallLinks } from "./schedule-call-dialog";
import {
  formatScheduledDate,
  resolveScheduledCallBanner,
  scheduledCallBannerId,
} from "./scheduled-call-presentation";

const bannerTitleId = `${scheduledCallBannerId}-title`;

/*
 * The next thing that happens with this candidate, stated where the page says
 * who they are — a sibling of the erasure tombstone above `CandidateVerdict`,
 * and built to the same shape: a bordered strip, an icon, a title line, then
 * the detail.
 *
 * It used to live inside the floating decision bar. A bar for advance / hold /
 * pass is not a place for durable state: hosting the full result card doubled
 * its width, put a light card inside a dark one, and left it overlaying the
 * review it was meant to sit beneath. The bar keeps a chip; the facts are
 * here.
 *
 * The section is a named landmark and a focus target (`tabIndex={-1}`) because
 * the chip at the bottom of the page anchors to it: a keyboard or screen
 * reader user has to LAND here, not just watch the viewport move. `scroll-mt`
 * covers the no-JS path, where the browser aligns the anchor to the top of the
 * viewport and the fixed mobile top bar would otherwise cover it.
 *
 * It also owns MOVING the call. One surface states where the call lives, so
 * that surface is where you change it: the trigger sits with the Calendar and
 * Meet links, and the chip in the decision bar keeps merely pointing here. The
 * scheduling dialog stays the single owner of the flow — when a call is booked
 * this is the only place it is mounted, because the chip replaces the
 * call-to-action that would otherwise mount a second one.
 */
export function ScheduledCallBanner({
  scheduledCall,
  ...scheduleProps
}: React.ComponentProps<typeof ScheduleCallDialog>) {
  const { i18n, t } = useTranslation();
  const banner = resolveScheduledCallBanner(scheduledCall, {
    canReschedule: scheduleProps.canSchedule,
  });

  if (!banner) {
    return null;
  }

  // The formatter degrades to the reader's own zone before it gives up, so a
  // null here means the instant itself is unreadable — which `resolve…` has
  // already ruled out. Kept honest rather than asserted away.
  const date = formatScheduledDate(
    banner.call.startsAt,
    banner.call.timeZone,
    i18n.language,
  );

  return (
    <section
      aria-labelledby={bannerTitleId}
      className="mt-6 flex scroll-mt-6 items-start gap-[11px] rounded-[14px] border border-[#d6e2c5] bg-[#f4f8ec] px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 max-[900px]:scroll-mt-28"
      id={scheduledCallBannerId}
      tabIndex={-1}
    >
      <Calendar
        aria-hidden={true}
        className="mt-0.5 h-4 w-4 shrink-0 text-[#4d6b2c]"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-950" id={bannerTitleId}>
          {t("schedule.nextCallScheduled")}
        </p>
        {date ? (
          <p className="mt-1 text-[13px] leading-[1.6] text-[#5a6846]">
            {t(banner.invitationMessageKey, { date })}
          </p>
        ) : null}
        {banner.showMeetPending ? (
          <p className="mt-1 text-[12px] leading-[1.6] text-ink-400">
            {t("schedule.meetPreparing")}
          </p>
        ) : null}
        {banner.showActions ? (
          <div className="mt-3">
            <ScheduledCallLinks
              action={
                banner.showReschedule ? (
                  <ScheduleCallDialog
                    {...scheduleProps}
                    renderTrigger={({ disabled, open }) => (
                      <button
                        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[#d6e2c5] bg-white px-3 text-[12px] font-semibold text-olive-900 transition hover:border-olive-700 disabled:cursor-not-allowed disabled:opacity-55"
                        disabled={disabled}
                        onClick={open}
                        type="button"
                      >
                        <Calendar aria-hidden={true} className="h-3.5 w-3.5" />
                        {t("schedule.reschedule")}
                      </button>
                    )}
                    scheduledCall={scheduledCall}
                  />
                ) : null
              }
              scheduledCall={banner.call}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
