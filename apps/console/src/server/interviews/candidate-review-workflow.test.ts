import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  candidateSession: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  candidateSessionReviewEvent: {
    createMany: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn((callback) => callback(tx)),
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

vi.mock("server-only", () => ({}));

import { updateCandidateSessionReview } from "./candidate-review-workflow";

describe("candidate review workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.candidateSession.findFirst.mockResolvedValue({
      id: "cs_123",
      reviewNote: "Needs scheduling clarification.",
      reviewStatus: "to_review",
    });
    tx.user.findFirst.mockResolvedValue({
      email: "recruiter@example.com",
      name: "Recruiter One",
    });
    tx.candidateSession.update.mockResolvedValue({});
    tx.candidateSessionReviewEvent.createMany.mockResolvedValue({ count: 2 });
  });

  it("updates current review state and writes status/note audit events", async () => {
    const outcome = await updateCandidateSessionReview({
      actorRole: "recruiter",
      actorUserId: "user_123",
      candidateSessionId: "cs_123",
      nextNote: "Call about availability and salary range fit.",
      nextStatus: "to_call",
      organizationId: "org_123",
    });

    expect(outcome).toMatchObject({
      changed: true,
      noteChanged: true,
      statusChanged: true,
    });
    expect(tx.candidateSession.findFirst).toHaveBeenCalledWith({
      select: {
        id: true,
        reviewNote: true,
        reviewStatus: true,
      },
      where: {
        id: "cs_123",
        organizationId: "org_123",
      },
    });
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      select: {
        email: true,
        name: true,
      },
      where: {
        id: "user_123",
        memberships: {
          some: {
            organizationId: "org_123",
            status: "active",
          },
        },
      },
    });
    expect(tx.candidateSession.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewNote: "Call about availability and salary range fit.",
        reviewNoteUpdatedBy: {
          connect: { id: "user_123" },
        },
        reviewStatus: "to_call",
        reviewStatusUpdatedBy: {
          connect: { id: "user_123" },
        },
      }),
      where: { id: "cs_123" },
    });
    expect(tx.candidateSessionReviewEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          authorUserId: "user_123",
          candidateSessionId: "cs_123",
          eventType: "status_changed",
          nextStatus: "to_call",
          organizationId: "org_123",
          previousStatus: "to_review",
        }),
        expect.objectContaining({
          authorUserId: "user_123",
          candidateSessionId: "cs_123",
          eventType: "note_updated",
          note: "Call about availability and salary range fit.",
          organizationId: "org_123",
        }),
      ]),
    });
  });

  it("rejects viewer mutation attempts before persistence", async () => {
    await expect(
      updateCandidateSessionReview({
        actorRole: "viewer",
        actorUserId: "user_viewer",
        candidateSessionId: "cs_123",
        nextNote: "Trying to edit.",
        nextStatus: "archived",
        organizationId: "org_123",
      }),
    ).rejects.toThrow("Viewer role cannot update candidate review.");

    expect(tx.candidateSession.update).not.toHaveBeenCalled();
    expect(tx.candidateSessionReviewEvent.createMany).not.toHaveBeenCalled();
  });

  it("rejects candidate sessions outside the active organization", async () => {
    tx.candidateSession.findFirst.mockResolvedValue(null);

    await expect(
      updateCandidateSessionReview({
        actorRole: "admin",
        actorUserId: "user_123",
        candidateSessionId: "cs_other",
        nextNote: "",
        nextStatus: "archived",
        organizationId: "org_123",
      }),
    ).rejects.toThrow("Candidate session was not found for this organization.");

    expect(tx.candidateSession.update).not.toHaveBeenCalled();
    expect(tx.candidateSessionReviewEvent.createMany).not.toHaveBeenCalled();
  });
});
