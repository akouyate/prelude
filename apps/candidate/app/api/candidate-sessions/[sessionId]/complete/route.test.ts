import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateInvitation: {
    updateMany: vi.fn(),
  },
  candidateSession: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const notificationMock = vi.hoisted(() => ({
  notifyCandidateInterviewCompleted: vi.fn(),
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@prelude/notifications", () => ({
  createNotificationDispatcher: () => notificationMock,
}));

import { POST } from "./route";

describe("POST /api/candidate-sessions/[sessionId]/complete", () => {
  beforeEach(() => {
    prismaMock.candidateInvitation.updateMany.mockReset();
    prismaMock.candidateSession.findFirst.mockReset();
    prismaMock.candidateSession.updateMany.mockReset();
    notificationMock.notifyCandidateInterviewCompleted.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a resumable candidate session completed", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "cinv_123",
    });

    const response = await POST(request({ resumeToken: "cs_resume" }), {
      params: Promise.resolve({ sessionId: "cs_123" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ completed: true });
    expect(prismaMock.candidateSession.updateMany).toHaveBeenCalledWith({
      data: {
        completedAt: expect.any(Date),
        status: "completed",
      },
      where: {
        id: "cs_123",
        resumeToken: "cs_resume",
        status: {
          in: [
            "agent_joining",
            "in_progress",
            "paused",
            "reconnecting",
            "started",
            "starting",
            "waiting_candidate",
          ],
        },
      },
    });
    expect(prismaMock.candidateSession.findFirst).toHaveBeenCalledWith({
      select: { candidateInvitationId: true },
      where: {
        id: "cs_123",
        resumeToken: "cs_resume",
      },
    });
    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { status: "completed" },
      where: {
        id: "cinv_123",
        status: { notIn: ["expired", "superseded"] },
      },
    });
    expect(
      notificationMock.notifyCandidateInterviewCompleted,
    ).toHaveBeenCalledWith({
      candidateSessionId: "cs_123",
    });
  });

  it("treats duplicate completion as idempotent when the same session is already completed", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.candidateSession.findFirst
      .mockResolvedValueOnce({
        status: "completed",
      })
      .mockResolvedValueOnce({
        candidateInvitationId: null,
      });

    const response = await POST(request({ resumeToken: "cs_resume" }), {
      params: Promise.resolve({ sessionId: "cs_123" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ completed: true });
    expect(prismaMock.candidateSession.findFirst).toHaveBeenCalledWith({
      select: { status: true },
      where: {
        id: "cs_123",
        resumeToken: "cs_resume",
      },
    });
    expect(
      notificationMock.notifyCandidateInterviewCompleted,
    ).toHaveBeenCalledWith({
      candidateSessionId: "cs_123",
    });
  });

  it("rejects completion without a matching resume token", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request({ resumeToken: "wrong" }), {
      params: Promise.resolve({ sessionId: "cs_123" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_session_not_found" },
    });
  });

  it("rejects terminal but incomplete sessions instead of rewriting them", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      status: "failed",
    });

    const response = await POST(request({ resumeToken: "cs_resume" }), {
      params: Promise.resolve({ sessionId: "cs_123" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_session_not_completable" },
    });
  });
});

function request(body: Record<string, unknown>) {
  return new Request(
    "http://candidate.test/api/candidate-sessions/cs_123/complete",
    {
      body: JSON.stringify(body),
      method: "POST",
    },
  );
}
