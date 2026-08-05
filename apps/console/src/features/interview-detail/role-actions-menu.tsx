"use client";

import * as React from "react";
import { MoreHoriz } from "iconoir-react";
import { useTranslation } from "react-i18next";

import { updateInterviewPublicationStatusAction } from "../../server/interviews/interview-actions";

export function RoleActionsMenu({
  interviewId,
  publicationStatus,
  roleTitle,
}: {
  interviewId: string;
  publicationStatus: string;
  roleTitle: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isPaused = publicationStatus === "paused";

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("interviewDetail.moreRoleActions")}
        className="grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-full border border-ink-200 bg-white text-ink-600 transition hover:border-ink-900 hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
        onClick={() => setOpen((previous) => !previous)}
        type="button"
      >
        <MoreHoriz aria-hidden={true} className="h-[18px] w-[18px]" />
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[50px] z-20 w-[236px] rounded-2xl border border-[#e7e2d8] bg-white p-1.5 shadow-[0_18px_40px_-20px_rgba(23,23,21,0.35)]"
          role="menu"
        >
          <form action={updateInterviewPublicationStatusAction}>
            <input name="interviewId" type="hidden" value={interviewId} />
            <input
              name="nextStatus"
              type="hidden"
              value={isPaused ? "published" : "paused"}
            />
            <button
              className="block w-full cursor-pointer rounded-[11px] px-3 py-2.5 text-left text-[13.5px] font-semibold text-ink-950 transition hover:bg-[#f4f2ea] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
              role="menuitem"
              type="submit"
            >
              {isPaused
                ? t("interviewDetail.resumeRoleButton")
                : t("interviewDetail.pauseRoleButton")}
              <span className="mt-[3px] block text-xs font-normal leading-[1.4] text-[#8a8178]">
                {isPaused
                  ? t("interviewDetail.resumeRoleBody", { roleTitle })
                  : t("interviewDetail.pauseRoleBody", { roleTitle })}
              </span>
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
