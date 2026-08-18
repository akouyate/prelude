"use client";

import { useTransition } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@prelude/ui";

import { deleteRecordingAction } from "../../server/interviews/recording-actions";
import type { CandidateRecordingStatus } from "../../server/interviews/recording-playback";

export function DeleteRecordingButton({
  candidateSessionId,
  canDelete,
  recordingStatus,
}: {
  candidateSessionId: string;
  canDelete: boolean;
  recordingStatus: CandidateRecordingStatus | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  // Restricted to owners/admins, and only when there is audio to erase. A
  // deleted/failed/absent recording has nothing to delete.
  if (!canDelete || recordingStatus !== "available") {
    return null;
  }

  const onDelete = () => {
    const confirmed = window.confirm(
      "Delete this recording? This permanently erases the candidate's interview audio and cannot be undone.",
    );
    if (!confirmed) {
      return;
    }
    // Fires from this click handler, not a reactive effect, so no
    // toastOnce/dedupe guard is needed. Deletion used to succeed silently
    // (the failure DID already surface, via an inline message right below
    // the button) — both outcomes now announce the same way, by toast, so
    // there is one place this action's result is ever shown, not two.
    startTransition(() => {
      deleteRecordingAction({ candidateSessionId })
        .then(() => {
          toast({
            dismissLabel: t("toast.dismiss"),
            message: t("toast.recordingDeleted"),
            tone: "success",
          });
        })
        .catch(() => {
          toast({
            dismissLabel: t("toast.dismiss"),
            duration: null,
            message: t("toast.recordingDeleteFailed"),
            tone: "danger",
          });
        });
    });
  };

  return (
    <div className="mt-2 flex items-center justify-end gap-3">
      <button
        className="cursor-pointer text-[12px] font-medium text-[#a29b8d] transition hover:text-red-600 disabled:cursor-default disabled:opacity-60"
        disabled={pending}
        onClick={onDelete}
        type="button"
      >
        {pending ? "Deleting…" : "Delete recording"}
      </button>
    </div>
  );
}
