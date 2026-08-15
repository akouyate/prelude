import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getWorkspaceBillingMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(
    async (operation: (transaction: typeof prismaMock) => unknown) =>
      operation(prismaMock),
  ),
  candidateInvitation: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  candidateSession: {
    count: vi.fn(),
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

vi.mock("@prelude/billing/server", () => ({
  getWorkspaceBilling: getWorkspaceBillingMock,
}));

// Both terminal writes below bypass `markCandidateSessionLifecycle`, so the
// route has to settle for itself. The rule is covered in
// `credit-settlement.test.ts`; here we pin that the calls exist.
const settleCandidateSessionCreditMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/server/credit-settlement", () => ({
  settleCandidateSessionCredit: settleCandidateSessionCreditMock,
}));

import { POST } from "./route";

describe("POST /api/live-interview-sessions", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubGlobal("fetch", vi.fn());
    getWorkspaceBillingMock.mockReset();
    getWorkspaceBillingMock.mockResolvedValue(unconfiguredBilling());
    prismaMock.candidateInvitation.findUnique.mockReset();
    prismaMock.candidateInvitation.updateMany.mockReset();
    prismaMock.interview.findFirst.mockReset();
    prismaMock.candidateSession.count.mockReset();
    prismaMock.candidateSession.count.mockResolvedValue(0);
    prismaMock.candidateSession.create.mockReset();
    prismaMock.candidateSession.findFirst.mockReset();
    prismaMock.candidateSession.update.mockReset();
    settleCandidateSessionCreditMock.mockReset();
    settleCandidateSessionCreditMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a consented candidate session from a published token", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
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
    vi.mocked(fetch).mockResolvedValueOnce(realtimeResponse(["audio"]));

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
      allowedModalities: ["audio"],
      livekit: {
        isMock: false,
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
          consentCopyVersion: "candidate-consent-v2",
          consentedAt: expect.any(Date),
          interviewId: "int_123",
          jobId: "job_123",
          organizationId: "org_123",
          resumeToken: expect.stringMatching(/^cs_/),
          startedAt: expect.any(Date),
          status: "starting",
        }),
      }),
    );
    expect(realtimeRequestBody()).toMatchObject({
      allowed_modalities: ["audio"],
      candidate_id: "cs_123",
      interview_plan_id: "int_123",
    });
  });

  it("blocks realtime provisioning when the candidate-start quota is reached", async () => {
    getWorkspaceBillingMock.mockResolvedValueOnce({
      ...unconfiguredBilling(),
      accessAllowed: true,
      entitlements: {
        activeRoleLimit: 25,
        candidateInterviewLimit: 0,
        recording: true,
      },
      planKey: "v1_workspace",
      planName: "V1 Workspace",
      state: "active",
    });
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);

    const response = await POST(
      request({
        candidateEmail: "ada@example.com",
        candidateName: "Ada",
        candidateToken: "iv_public",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_interview_limit_reached" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("creates a consented candidate session from a candidate invitation token", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(
      candidateInvitation(),
    );
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession({ candidateInvitationId: "cinv_123" }),
    );
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...candidateSession({ candidateInvitationId: "cinv_123" }),
      realtimeSessionId: "is_real",
      status: "waiting_candidate",
    });
    vi.mocked(fetch).mockResolvedValueOnce(realtimeResponse(["audio"]));

    const response = await POST(
      request({
        candidateEmail: "ADA@example.com",
        candidateName: " Ada Lovelace ",
        candidateToken: "ci_public",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      productSessionId: "cs_123",
      resumeToken: "cs_resume",
    });
    expect(prismaMock.interview.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateInvitationId: "cinv_123",
          interviewId: "int_123",
          status: "starting",
        }),
      }),
    );
    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consentCopyVersion: "candidate-consent-v2",
          status: "starting",
        }),
        where: expect.objectContaining({ id: "cinv_123" }),
      }),
    );
  });

  it("resumes a matching candidate session when a resume token is provided", async () => {
    const existingSession = candidateSession({
      id: "cs_existing",
      resumeToken: "cs_resume",
      startedAt: new Date("2026-06-20T09:00:00.000Z"),
      status: "waiting_candidate",
    });
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(
      existingSession,
    );
    prismaMock.candidateSession.update
      .mockResolvedValueOnce({
        ...existingSession,
        candidateEmail: "ada@example.com",
        candidateName: "Ada",
        status: "starting",
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
      },
    });
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consentCopyVersion: "candidate-consent-v2",
          consentedAt: expect.any(Date),
          startedAt: existingSession.startedAt,
          status: "starting",
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
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
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

  it("supersedes a failed attempt and creates a fresh retry attempt", async () => {
    const failedSession = candidateSession({
      id: "cs_failed",
      resumeToken: "cs_resume",
      status: "failed",
    });
    const retrySession = candidateSession({
      id: "cs_retry",
      resumeToken: "cs_retry_resume",
      status: "starting",
    });
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(failedSession);
    prismaMock.candidateSession.update
      .mockResolvedValueOnce({
        ...retrySession,
        realtimeSessionId: "is_real",
        status: "starting",
      })
      .mockResolvedValueOnce({ ...failedSession, status: "superseded" });
    prismaMock.candidateSession.create.mockResolvedValueOnce(retrySession);
    vi.mocked(fetch).mockResolvedValueOnce(realtimeResponse(["audio"]));

    const response = await POST(
      request({
        candidateToken: "iv_public",
        consentAccepted: true,
        resumeToken: "cs_resume",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      productSessionId: "cs_retry",
      resumeToken: "cs_retry_resume",
    });
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: { id: "cs_failed" },
    });
    expect(settleCandidateSessionCreditMock).toHaveBeenCalledWith(prismaMock, {
      kind: "superseded",
      now: expect.any(Date),
      sessionId: "cs_failed",
    });
    expect(prismaMock.candidateSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resumeToken: expect.stringMatching(/^cs_/),
          status: "starting",
        }),
      }),
    );
    expect(realtimeRequestBody()).toMatchObject({
      candidate_id: "cs_retry",
    });
  });

  it("keeps the previous failed attempt retryable when realtime preparation fails", async () => {
    const failedSession = candidateSession({
      id: "cs_failed",
      resumeToken: "cs_resume",
      status: "failed",
    });
    const retrySession = candidateSession({
      id: "cs_retry",
      resumeToken: "cs_retry_resume",
      status: "starting",
    });
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(failedSession);
    prismaMock.candidateSession.create.mockResolvedValueOnce(retrySession);
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...retrySession,
      status: "failed",
    });
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

    const response = await POST(
      request({
        candidateToken: "iv_public",
        consentAccepted: true,
        resumeToken: "cs_resume",
      }),
    );

    expect(response.status).toBe(502);
    expect(prismaMock.candidateSession.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: { status: "failed" },
      where: { id: "cs_retry" },
    });
    expect(prismaMock.candidateSession.update).not.toHaveBeenCalledWith({
      data: { status: "superseded" },
      where: { id: "cs_failed" },
    });
    // The credit was reserved at admission moments earlier and the room never
    // came up; nothing else in the flow would ever hand it back.
    expect(settleCandidateSessionCreditMock).toHaveBeenCalledWith(prismaMock, {
      kind: "failed",
      now: expect.any(Date),
      sessionId: "cs_retry",
    });
  });

  it("settles the credit when provisioning reports an already-terminal session", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession(),
    );
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...candidateSession(),
      realtimeSessionId: "is_real",
      status: "expired",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      realtimeResponse(["audio"], "lk_is_real", "expired"),
    );

    const response = await POST(
      request({ candidateToken: "iv_public", consentAccepted: true }),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: { realtimeSessionId: "is_real", status: "expired" },
      where: { id: "cs_123" },
    });
    // This terminal write bypasses `markCandidateSessionLifecycle` too, so nothing
    // downstream would ever hand back the credit reserved at admission.
    expect(settleCandidateSessionCreditMock).toHaveBeenCalledWith(prismaMock, {
      kind: "expired",
      now: expect.any(Date),
      sessionId: "cs_123",
    });
  });

  it("leaves the hold alone when provisioning reports a session still under way", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession(),
    );
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...candidateSession(),
      realtimeSessionId: "is_real",
      status: "in_progress",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      realtimeResponse(["audio"], "lk_is_real", "in_progress"),
    );

    const response = await POST(
      request({ candidateToken: "iv_public", consentAccepted: true }),
    );

    expect(response.status).toBe(200);
    // The interview is about to run on this hold; settling now would release it.
    expect(settleCandidateSessionCreditMock).not.toHaveBeenCalled();
  });

  it("frees quota when realtime returns a malformed success payload", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession({ status: "starting" }),
    );
    prismaMock.candidateSession.update.mockResolvedValueOnce({
      ...candidateSession(),
      status: "failed",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("not-json", {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const response = await POST(
      request({
        candidateToken: "iv_public",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "realtime_api_invalid_response" },
    });
    expect(prismaMock.candidateSession.update).toHaveBeenCalledWith({
      data: { status: "failed" },
      where: { id: "cs_123" },
    });
  });

  it("does not overwrite a completed attempt when a stale resume token is reused", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(
      candidateSession({ status: "completed" }),
    );

    const response = await POST(
      request({
        candidateToken: "iv_public",
        consentAccepted: true,
        resumeToken: "cs_resume",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_session_already_completed" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("requires explicit consent before creating a product or realtime session", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
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

  it("expires a stale candidate invitation before creating a session", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(
      candidateInvitation({
        expiresAt: new Date("2026-06-19T10:00:00.000Z"),
      }),
    );

    const response = await POST(
      request({
        candidateToken: "ci_public",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_session_expired" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
    expect(prismaMock.candidateInvitation.updateMany).toHaveBeenCalledWith({
      data: { status: "expired" },
      where: { id: "cinv_123" },
    });
  });

  it("rejects a second active attempt for the same invitation without a resume token", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(
      candidateInvitation(),
    );
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(
      candidateSession({
        candidateInvitationId: "cinv_123",
        status: "starting",
      }),
    );

    const response = await POST(
      request({
        candidateToken: "ci_public",
        consentAccepted: true,
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_session_not_resumable" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prismaMock.candidateSession.create).not.toHaveBeenCalled();
  });

  it("refuses a mock interview room when mock mode is not allowed", async () => {
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
    prismaMock.interview.findFirst.mockResolvedValueOnce(publishedInterview());
    prismaMock.candidateSession.findFirst.mockResolvedValueOnce(null);
    prismaMock.candidateSession.create.mockResolvedValueOnce(
      candidateSession(),
    );
    prismaMock.candidateSession.update
      .mockResolvedValueOnce({
        ...candidateSession(),
        realtimeSessionId: "is_real",
        status: "waiting_candidate",
      })
      .mockResolvedValueOnce({ ...candidateSession(), status: "failed" });
    vi.mocked(fetch).mockResolvedValueOnce(
      realtimeResponse(["audio"], "mock_lk_is_real"),
    );

    const response = await POST(
      request({ candidateToken: "iv_public", consentAccepted: true }),
    );

    // A real candidate must never silently sit through a fake, no-audio interview.
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "mock_interview_refused" },
    });
  });

  it("allows a mock interview room when ALLOW_MOCK_INTERVIEW is set (local smoke)", async () => {
    vi.stubEnv("ALLOW_MOCK_INTERVIEW", "true");
    prismaMock.candidateInvitation.findUnique.mockResolvedValueOnce(null);
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
      realtimeResponse(["audio"], "mock_lk_is_real"),
    );

    const response = await POST(
      request({ candidateToken: "iv_public", consentAccepted: true }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      livekit: { isMock: true },
    });
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
    status: "published",
  };
}

function candidateInvitation(overrides: Record<string, unknown> = {}) {
  return {
    candidateEmail: null,
    candidateName: null,
    expiresAt: new Date("2027-06-21T10:00:00.000Z"),
    id: "cinv_123",
    interview: publishedInterview(),
    openedAt: null,
    status: "invited",
    token: "ci_public",
    ...overrides,
  };
}

function candidateSession(overrides: Record<string, unknown> = {}) {
  return {
    candidateEmail: "ada@example.com",
    candidateName: "Ada Lovelace",
    consentCopyVersion: "candidate-consent-v2",
    consentedAt: new Date("2026-06-20T10:00:00.000Z"),
    id: "cs_123",
    interviewId: "int_123",
    jobId: "job_123",
    organizationId: "org_123",
    realtimeSessionId: null,
    resumeToken: "cs_resume",
    startedAt: new Date("2026-06-20T10:00:00.000Z"),
    status: "starting",
    ...overrides,
  };
}

function unconfiguredBilling() {
  return {
    accessAllowed: true,
    entitlements: {
      activeRoleLimit: Number.MAX_SAFE_INTEGER,
      candidateInterviewLimit: Number.MAX_SAFE_INTEGER,
      recording: true,
    },
    isFreeTrial: false,
    periodEnd: null,
    periodStart: null,
    planId: null,
    planKey: "unknown",
    planName: "Billing not configured",
    planSlug: null,
    sourceUpdatedAt: new Date("2026-07-24T10:00:00.000Z"),
    state: "unconfigured",
    subscriptionId: null,
    subscriptionItemId: null,
    subscriptionItemStatus: null,
    subscriptionStatus: null,
  };
}

function realtimeResponse(
  allowedModalities: string[],
  token = "lk_is_real",
  status = "waiting_candidate",
) {
  return Response.json({
    livekit_join: {
      expires_at: "2026-06-20T10:15:00.000Z",
      participant: "candidate-cs_123",
      room_name: "prelude-is_real",
      token,
      url: "wss://mock-livekit.prelude.local",
    },
    session: {
      allowed_modalities: allowedModalities,
      id: "is_real",
      livekit_room_name: "prelude-is_real",
      status,
    },
  });
}

function realtimeRequestBody() {
  const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];

  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}
