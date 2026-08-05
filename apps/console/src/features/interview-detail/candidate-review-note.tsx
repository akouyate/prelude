"use client";

import * as React from "react";

import { candidateReviewNoteMaxLength } from "../../domain/candidate-review-policy";

type SaveState = "idle" | "saved" | "saving";

const autosaveDelayMs = 700;

export function CandidateReviewNote({
  canManageReview,
  onSave,
  reviewNote,
}: {
  canManageReview: boolean;
  onSave: (note: string) => Promise<void>;
  reviewNote: string | null;
}) {
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handleChange = (value: string) => {
    setSaveState("saving");

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      void onSave(value).then(() => setSaveState("saved"));
    }, autosaveDelayMs);
  };

  return (
    <section className="mt-[30px]">
      <div className="mb-2.5 flex items-center justify-between gap-2.5">
        <p className="font-title text-[10px] font-semibold uppercase tracking-[0.1em] text-[#b3ac9d]">
          Internal note
        </p>
        <span className="font-title text-[11.5px] font-medium text-ink-400">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : ""}
        </span>
      </div>
      <textarea
        className="min-h-[76px] w-full resize-y rounded-xl border border-[#e7e2d8] bg-[#fbf9f6] px-3.5 py-3 text-[13.5px] leading-[1.6] text-ink-950 outline-none transition focus:border-ink-900 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        defaultValue={reviewNote ?? ""}
        disabled={!canManageReview}
        maxLength={candidateReviewNoteMaxLength}
        onChange={(event) => handleChange(event.currentTarget.value)}
        placeholder="Private to your team — saves as you type."
      />
    </section>
  );
}
