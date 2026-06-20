import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateSession: {
    updateMany: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

import { POST } from "./route";

describe("POST /api/candidate-sessions/[sessionId]/complete", () => {
  beforeEach(() => {
    prismaMock.candidateSession.updateMany.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks a resumable candidate session completed", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 1 });

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
          in: ["failed", "in_progress", "started", "waiting_candidate"],
        },
      },
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
