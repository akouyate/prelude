import { describe, expect, it } from "vitest";

import {
  candidateReviewNoteMaxLength,
  canManageCandidateReview,
  prepareCandidateReviewUpdate,
} from "./candidate-review-policy";

describe("candidate review policy", () => {
  it("allows owner, admin, and recruiter to manage human review", () => {
    expect(canManageCandidateReview("owner")).toBe(true);
    expect(canManageCandidateReview("admin")).toBe(true);
    expect(canManageCandidateReview("recruiter")).toBe(true);
  });

  it("rejects viewer mutations server-side", () => {
    const result = prepareCandidateReviewUpdate({
      currentNote: null,
      currentStatus: "to_review",
      nextNote: "Call about availability.",
      nextStatus: "to_call",
      role: "viewer",
    });

    expect(result).toEqual({
      error: "Viewer role cannot update candidate review.",
      ok: false,
    });
  });

  it("validates review status against the V1 human workflow", () => {
    const result = prepareCandidateReviewUpdate({
      currentNote: null,
      currentStatus: "to_review",
      nextNote: "",
      nextStatus: "qualified",
      role: "recruiter",
    });

    expect(result).toEqual({
      error: "Choose a valid human review status.",
      ok: false,
    });
  });

  it("normalizes note text and detects status and note changes", () => {
    const result = prepareCandidateReviewUpdate({
      currentNote: "Old note",
      currentStatus: "to_review",
      nextNote: "  Candidate asked for morning follow-up.  \n",
      nextStatus: "to_call",
      role: "recruiter",
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        normalizedNote: "Candidate asked for morning follow-up.",
        normalizedStatus: "to_call",
        noteChanged: true,
        statusChanged: true,
      },
    });
  });

  it("treats an empty note as clearing the internal note", () => {
    const result = prepareCandidateReviewUpdate({
      currentNote: "Clear this",
      currentStatus: "to_call",
      nextNote: "   \n",
      nextStatus: "to_call",
      role: "admin",
    });

    expect(result).toEqual({
      ok: true,
      plan: {
        normalizedNote: null,
        normalizedStatus: "to_call",
        noteChanged: true,
        statusChanged: false,
      },
    });
  });

  it("rejects notes over the V1 storage limit", () => {
    const result = prepareCandidateReviewUpdate({
      currentNote: null,
      currentStatus: "to_review",
      nextNote: "x".repeat(candidateReviewNoteMaxLength + 1),
      nextStatus: "to_review",
      role: "owner",
    });

    expect(result).toEqual({
      error: `Internal note must stay under ${candidateReviewNoteMaxLength} characters.`,
      ok: false,
    });
  });
});
