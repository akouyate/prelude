import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  candidateSession: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  interview: {
    findFirst: vi.fn(),
  },
}));

vi.mock("@prelude/db", () => ({
  prisma: prismaMock,
}));

import { POST } from "./route";

describe("POST /api/live-interview-sessions", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubGlobal("fetch", vi.fn());
    prismaMock.interview.findFirst.mockReset();
    prismaMock.candidateSession.create.mockReset();
    prismaMock.candidateSession.findFirst.mockReset();
    prismaMock.candidateSession.update.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a consented candidate session from a published token", async () => {
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession(),
    );
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...candidateSession(),
      realtimeSessionId: "is_real",
      status: "waiting_candidate",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      realtimeResponse(["audio", "video"]),
    );

    const response = await POST(
      request({
        candidateEmail: "ADA@example.com",
        candidateName: " Ada Lovelace ",
        candidateToken: "iv_public",
        consentAccepted: true,
        videoEnabled: true,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      allowedModalities: ["audio", "video"],
      livekit: {
        isMock: true,
        participant: "candidate-cs_123",
        roomName: "prelude-is_real",
      },
      productSessionId: "cs_123",
      resumeToken: "cs_resume",
      sessionId: "is_real",
      status: "waiting_candidate",
    });
    expect(prismaMock.candidateSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateEmail: "ada@example.com",
          candidateName: "Ada Lovelace",
          consentCopyVersion: "candidate-consent-v1",
          consentedAt: expect.any(Date),
          interviewId: "int_123",
          jobId: "job_123",
          organizationId: "org_123",
          resumeToken: expect.stringMatching(/^cs_/),
          startedAt: expect.any(Date),
          status: "started",
        }),
      }),
    );
    expect(realtimeRequestBody()).toMatchObject({
      allowed_modalities: ["audio", "video"],
      candidate_id: "cs_123",
      interview_plan_id: "int_123",
    });
  });

  it("resumes a matching candidate session when a resume token is provided", async () => {
    const existingSession = candidateSession({
      id: "cs_existing",
      resumeToken: "cs_resume",
      startedAt: new Date("2026-06-20T09:00:00.000Z"),
      status: "waiting_candidate",
    });
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(
      existingSession,
    );
    prismaMock.candidateSession.update
      .mockResolvedValueOnce({
        ...existingSession,
        candidateEmail: "ada@example.com",
        candidateName: "Ada",
        status: "started",
      })
      .mockResolvedValueOnce({
        ...existingSession,
        realtimeSessionId: "is_real",
        status: "waiting_candidate",
      });
    vi.mocked(fetch).mockResolvedValueOnce(realtimeResponse(["audio"]));

    const response = await POST(
      request({
        candidateEmail: "ada@example.com",
        candidateName: "Ada",
        candidateToken: "iv_public",
        consentAccepted: true,
        resumeToken: "cs_resume",
        videoEnabled: false,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      allowedModalities: ["audio"],
      productSessionId: "cs_existing",
      resumeToken: "cs_resume",
    });
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.findFirst).toHaveBeenCalledWith({
      where: {
        interviewId: "int_123",
        resumeToken: "cs_resume",
        status: {
          in: ["created", "failed", "started", "waiting_candidate"],
        },
      },
    });
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consentCopyVersion: "candidate-consent-v1",
          consentedAt: expect.any(Date),
          startedAt: existingSession.startedAt,
          status: "started",
        }),
        where: { id: "cs_existing" },
      }),
    );
    expect(realtimeRequestBody()).toMatchObject({
      allowed_modalities: ["audio"],
      candidate_id: "cs_existing",
      interview_plan_id: "int_123",
    });
  });

  it("rejects an unknown or unpublished candidate token", async () => {
    prismaMock.interview.findFirst.mockResolvedValueOnce(null);

    const response = await POST(
      request({
        candidateToken: "iv_unknown",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "interview_not_found" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("requires explicit consent before creating a product or realtime session", async () => {
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());

    const response = await POST(
      request({
        candidateToken: "iv_public",
        consentAccepted: false,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "consent_required" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.update).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new Request("http://candidate.test/api/live-interview-sessions", {
    body: JSON.stringify(body),
    method: "POST",
  });
}

function publishedInterview() {
  return {
    estimatedMinutes: 4,
    id: "int_123",
    job: { title: "Customer Success Manager" },
    jobId: "job_123",
    organization: { name: "Acme Talent" },
    organizationId: "org_123",
    publicToken: "iv_public",
    responseModes: ["audio", "video"],
    roleTitle: "Customer Success Manager",
  };
}

function candidateSession(overrides: Record<string, unknown> = {}) {
  return {
    candidateEmail: "ada@example.com",
    candidateName: "Ada Lovelace",
    consentCopyVersion: "candidate-consent-v1",
    consentedAt: new Date("2026-06-20T10:00:00.000Z"),
    id: "cs_123",
    interviewId: "int_123",
    jobId: "job_123",
    organizationId: "org_123",
    realtimeSessionId: null,
    resumeToken: "cs_resume",
    startedAt: new Date("2026-06-20T10:00:00.000Z"),
    status: "started",
    ...overrides,
  };
}

function realtimeResponse(allowedModalities: string[]) {
  return Response.json({
    livekit_join: {
      expires_at: "2026-06-20T10:15:00.000Z",
      participant: "candidate-cs_123",
      room_name: "prelude-is_real",
      token: "mock_lk_is_real",
      url: "wss://mock-livekit.prelude.local",
    },
    session: {
      allowed_modalities: allowedModalities,
      id: "is_real",
      livekit_room_name: "prelude-is_real",
      status: "waiting_candidate",
    },
  });
}

function realtimeRequestBody() {
  const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];

  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}
