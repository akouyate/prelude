import {
  isRecruiterReviewStatus,
  type OrganizationRole,
  type RecruiterReviewStatus,
} from "@prelude/types";

export const candidateReviewNoteMaxLength = 2000;

export type CandidateReviewUpdatePlan = {
  noteChanged: boolean;
  normalizedNote: string | null;
  normalizedStatus: RecruiterReviewStatus;
  statusChanged: boolean;
};

export type CandidateReviewUpdateResult =
  | {
      ok: true;
      plan: CandidateReviewUpdatePlan;
    }
  | {
      error: string;
      ok: false;
    };

export function canManageCandidateReview(role: OrganizationRole) {
  return role === "owner" || role === "admin" || role === "recruiter";
}

export function prepareCandidateReviewUpdate({
  currentNote,
  currentStatus,
  nextNote,
  nextStatus,
  role,
}: {
  currentNote: string | null;
  currentStatus: string | null | undefined;
  nextNote: string;
  nextStatus: string;
  role: OrganizationRole;
}): CandidateReviewUpdateResult {
  if (!canManageCandidateReview(role)) {
    return {
      error: "Viewer role cannot update candidate review.",
      ok: false,
    };
  }

  if (!isRecruiterReviewStatus(nextStatus)) {
    return {
      error: "Choose a valid human review status.",
      ok: false,
    };
  }

  const normalizedNote = normalizeCandidateReviewNote(nextNote);

  if (normalizedNote.length > candidateReviewNoteMaxLength) {
    return {
      error: `Internal note must stay under ${candidateReviewNoteMaxLength} characters.`,
      ok: false,
    };
  }

  const persistedNote = normalizedNote.length > 0 ? normalizedNote : null;
  const persistedStatus = isRecruiterReviewStatus(currentStatus)
    ? currentStatus
    : "to_review";

  return {
    ok: true,
    plan: {
      noteChanged: (currentNote ?? null) !== persistedNote,
      normalizedNote: persistedNote,
      normalizedStatus: nextStatus,
      statusChanged: persistedStatus !== nextStatus,
    },
  };
}

function normalizeCandidateReviewNote(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
