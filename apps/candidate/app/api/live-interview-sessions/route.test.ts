import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/live-interview-sessions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a real LiveKit join token from the Go realtime API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            session: {
              id: "is_real",
              status: "waiting_candidate",
              livekit_room_name: "prelude-is_real",
              allowed_modalities: ["audio", "video"]
            },
            livekit_join: {
              room_name: "prelude-is_real",
              url: "wss://prelude.livekit.cloud",
              token: "real.jwt.token",
              participant: "candidate-demo-token",
              expires_at: "2026-06-18T10:15:00Z"
            }
          },
          { status: 201 }
        )
      )
    );

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-sessions", {
        method: "POST",
        body: JSON.stringify({
          candidateToken: "demo-token",
          videoEnabled: true
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "is_real",
      status: "waiting_candidate",
      allowedModalities: ["audio", "video"],
      livekit: {
        roomName: "prelude-is_real",
        url: "wss://prelude.livekit.cloud",
        token: "real.jwt.token",
        participant: "candidate-demo-token",
        expiresAt: "2026-06-18T10:15:00Z",
        isMock: false
      }
    });
  });

  it("keeps mock detection for local LiveKit fallback tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            session: {
              id: "is_mock",
              status: "waiting_candidate",
              livekit_room_name: "prelude-is_mock",
              allowed_modalities: ["audio"]
            },
            livekit_join: {
              room_name: "prelude-is_mock",
              url: "wss://mock-livekit.prelude.local",
              token: "mock_lk_is_mock_candidate-demo-token",
              participant: "candidate-demo-token",
              expires_at: "2026-06-18T10:15:00Z"
            }
          },
          { status: 201 }
        )
      )
    );

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-sessions", {
        method: "POST",
        body: JSON.stringify({
          candidateToken: "demo-token",
          videoEnabled: false
        })
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allowedModalities).toEqual(["audio"]);
    expect(body.livekit.isMock).toBe(true);
  });
});
