import { beforeEach, describe, expect, it, vi } from "vitest";

const preparePreviewMock = vi.hoisted(() => vi.fn());
const provisionMock = vi.hoisted(() => vi.fn());
const releaseReservationMock = vi.hoisted(() => vi.fn());
const confirmMarketingDemoMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/server/candidate-experience-previews", () => ({
  prepareCandidateExperiencePreviewSession: preparePreviewMock,
  releaseCandidateExperiencePreviewReservation: releaseReservationMock,
}));
vi.mock("../../../src/server/realtime-session-provisioning", () => ({
  provisionRealtimeSession: provisionMock,
}));
vi.mock("../../../src/server/marketing-demo-admission", () => ({
  confirmMarketingDemoProvisioning: confirmMarketingDemoMock,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  releaseReservationMock.mockResolvedValue(undefined);
  confirmMarketingDemoMock.mockResolvedValue(undefined);
  preparePreviewMock.mockResolvedValue({
    allowedModalities: ["audio"],
    candidateId: "preview_candidate_1",
    expiresAt: new Date("2026-08-03T10:45:00.000Z"),
    interviewPlanId: "pv_1",
    ok: true,
    reservation: {
      previousLiveTestCount: 0,
      previousRuntimeExpiresAt: null,
      previewId: "pv_1",
      runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
    },
  });
  provisionMock.mockResolvedValue({
    isMock: false,
    ok: true,
    payload: {
      livekit_join: {
        expires_at: "2026-08-03T10:15:00.000Z",
        participant: "candidate-preview_candidate_1",
        room_name: "hirecall-preview-room",
        token: "lk_real",
        url: "wss://livekit.test",
      },
      session: {
        allowed_modalities: ["audio"],
        id: "is_preview_1",
        livekit_room_name: "hirecall-preview-room",
        status: "waiting_candidate",
      },
    },
  });
});

describe("POST /api/live-interview-preview-sessions", () => {
  it("provisions a preview-kind realtime session without a product session", async () => {
    const response = await POST(
      new Request("http://candidate.test/api/live-interview-preview-sessions", {
        body: JSON.stringify({
          consentAccepted: true,
          previewToken: "pvtk_abcdefghijklmnopqrstuvwxyz",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      productSessionId: null,
      resumeToken: null,
      sessionId: "is_preview_1",
    });
    expect(provisionMock).toHaveBeenCalledWith({
      allowedModalities: ["audio"],
      candidateId: "preview_candidate_1",
      expiresAt: new Date("2026-08-03T10:45:00.000Z"),
      interviewPlanId: "pv_1",
      kind: "preview",
    });
  });

  it("fails before realtime when the preview has expired", async () => {
    preparePreviewMock.mockResolvedValueOnce({
      error: "preview_not_found",
      ok: false,
      status: 404,
    });

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-preview-sessions", {
        body: JSON.stringify({
          consentAccepted: true,
          previewToken: "pvtk_abcdefghijklmnopqrstuvwxyz",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("confirms the one marketing room without creating product identity or resume data", async () => {
    preparePreviewMock.mockResolvedValueOnce({
      allowedModalities: ["audio"],
      candidateId: "marketing_demo_candidate_1",
      expiresAt: new Date("2026-08-03T10:12:00.000Z"),
      interviewPlanId: "pv_marketing_1",
      ok: true,
      reservation: {
        day: new Date("2026-08-03T00:00:00.000Z"),
        kind: "marketing_demo",
        previewId: "pv_marketing_1",
        runtimeExpiresAt: new Date("2026-08-03T10:12:00.000Z"),
      },
    });

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-preview-sessions", {
        body: JSON.stringify({
          consentAccepted: true,
          previewToken: "pvtk_abcdefghijklmnopqrstuvwxyz",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      productSessionId: null,
      resumeToken: null,
      sessionId: "is_preview_1",
    });
    expect(confirmMarketingDemoMock).toHaveBeenCalledWith({
      previewId: "pv_marketing_1",
      realtimeSessionId: "is_preview_1",
      runtimeExpiresAt: new Date("2026-08-03T10:12:00.000Z"),
    });
  });

  it("releases the attempt when realtime provisioning fails", async () => {
    provisionMock.mockResolvedValueOnce({
      code: "realtime_api_unavailable",
      ok: false,
      status: 502,
    });

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-preview-sessions", {
        body: JSON.stringify({
          consentAccepted: true,
          previewToken: "pvtk_abcdefghijklmnopqrstuvwxyz",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(releaseReservationMock).toHaveBeenCalledWith({
      previousLiveTestCount: 0,
      previousRuntimeExpiresAt: null,
      previewId: "pv_1",
      runtimeExpiresAt: new Date("2026-08-03T10:45:00.000Z"),
    });
  });

  it("keeps an ambiguous marketing reservation when realtime may have created a room", async () => {
    preparePreviewMock.mockResolvedValueOnce({
      allowedModalities: ["audio"],
      candidateId: "marketing_demo_candidate_1",
      expiresAt: new Date("2026-08-03T10:12:00.000Z"),
      interviewPlanId: "pv_marketing_1",
      ok: true,
      reservation: {
        day: new Date("2026-08-03T00:00:00.000Z"),
        kind: "marketing_demo",
        previewId: "pv_marketing_1",
        runtimeExpiresAt: new Date("2026-08-03T10:12:00.000Z"),
      },
    });
    provisionMock.mockResolvedValueOnce({
      code: "realtime_api_unavailable",
      ok: false,
      status: 502,
    });

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-preview-sessions", {
        body: JSON.stringify({
          consentAccepted: true,
          previewToken: "pvtk_abcdefghijklmnopqrstuvwxyz",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(502);
    expect(releaseReservationMock).not.toHaveBeenCalled();
  });
});
