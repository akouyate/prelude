import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/live-interview-sessions/[sessionId]/transcript", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("proxies and normalizes realtime transcript turns", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        transcript: [
          {
            turn_id: "turn_1",
            session_id: "is_ready",
            question_id: "intro",
            speaker: "interviewer",
            text: "Can you introduce yourself?",
            is_final: true,
            started_at: "2026-06-21T09:00:00Z",
            ended_at: "2026-06-21T09:00:03Z",
          },
          {
            turnId: "turn_2",
            sessionId: "is_ready",
            speaker: "candidate",
            text: "Yes.",
            isFinal: true,
            startedAt: "2026-06-21T09:00:05Z",
          },
          {
            turn_id: "missing_text",
            session_id: "is_ready",
            speaker: "interviewer",
            started_at: "2026-06-21T09:00:07Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/transcript",
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      transcript: [
        {
          turnId: "turn_1",
          sessionId: "is_ready",
          questionId: "intro",
          speaker: "interviewer",
          text: "Can you introduce yourself?",
          isFinal: true,
          startedAt: "2026-06-21T09:00:00Z",
          endedAt: "2026-06-21T09:00:03Z",
        },
        {
          turnId: "turn_2",
          sessionId: "is_ready",
          speaker: "candidate",
          text: "Yes.",
          isFinal: true,
          startedAt: "2026-06-21T09:00:05Z",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/interview-sessions/is_ready/transcript",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );
  });

  it("returns a 502 when realtime transcript is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(null));

    const response = await GET(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/transcript",
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "transcript_unavailable" },
    });
  });
});
