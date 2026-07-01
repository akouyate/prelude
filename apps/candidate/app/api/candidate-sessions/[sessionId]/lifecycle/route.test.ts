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

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

import { POST } from "./route";

describe("POST /api/candidate-sessions/[sessionId]/lifecycle", () => {
  beforeEach(() => {
    prismaMock.candidateInvitation.updateMany.mockReset();
    prismaMock.candidateSession.findFirst.mockReset();
    prismaMock.candidateSession.updateMany.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks an active candidate session abandoned", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      candidateInvitationId: "cinv_123",
    });

    const response = await POST(
      request({ action: "abandon", resumeToken: "cs_resume" }),
      {
        params: Promise.resolve({ sessionId: "cs_123" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "abandoned" });
    expect(prismaMock.candidateSession.updateMany).toHaveBeenCalledWith({
      data: { status: "abandoned" },
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
    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { status: "abandoned" },
      where: {
        id: "cinv_123",
        status: { notIn: ["expired", "superseded"] },
      },
    });
  });

  it("treats duplicate lifecycle updates as idempotent", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      status: "abandoned",
    });

    const response = await POST(
      request({ action: "abandon", resumeToken: "cs_resume" }),
      {
        params: Promise.resolve({ sessionId: "cs_123" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "abandoned" });
  });

  it("does not rewrite a completed candidate session", async () => {
    prismaMock.candidateSession.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce({
      status: "completed",
    });

    const response = await POST(
      request({ action: "abandon", resumeToken: "cs_resume" }),
      {
        params: Promise.resolve({ sessionId: "cs_123" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "completed" });
  });

  it("rejects unsupported lifecycle actions", async () => {
    const response = await POST(
      request({ action: "complete", resumeToken: "cs_resume" }),
      {
        params: Promise.resolve({ sessionId: "cs_123" }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unsupported_lifecycle_action" },
    });
    expect(prismaMock.candidateSession.updateMany).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request(
    "http://candidate.test/api/candidate-sessions/cs_123/lifecycle",
    {
      body: JSON.stringify(body),
      method: "POST",
    },
  );
}
