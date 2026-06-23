"use client";

import { useState, useTransition } from "react";

import { deleteRecordingAction } from "../../server/interviews/recording-actions";

type RecordingStatus = "available" | "processing" | "failed" | "deleted" | null;

export function DeleteRecordingButton({
  candidateSessionId,
  canDelete,
  recordingStatus,
}: {
  candidateSessionId: string;
  canDelete: boolean;
  recordingStatus: RecordingStatus;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    startTransition(() => {
      deleteRecordingAction({ candidateSessionId }).catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to delete the recording.",
        );
      });
    });
  };

  return (
    <div className="mt-2 flex items-center justify-end gap-3">
      {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
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
