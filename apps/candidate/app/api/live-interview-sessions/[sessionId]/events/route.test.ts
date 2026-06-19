import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

describe("POST /api/live-interview-sessions/[sessionId]/events", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits candidate_joined with the next sequence number", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: {
            id: "is_ready",
            candidate_id: "candidate-demo",
            events: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ duplicate: false }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({
            type: "candidate_joined",
            payload: {
              candidate_participant_id: "candidate-is-ready",
              room_name: "prelude-is-ready",
              modes: ["audio"],
            },
          }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const eventRequestInit = fetchMock.mock.calls[1]?.[1];
    expect(eventRequestInit).toBeDefined();
    expect(JSON.parse(String(eventRequestInit?.body))).toMatchObject({
      event_id: "evt_is_ready_candidate_joined",
      type: "candidate_joined",
      actor: "candidate",
      sequence_number: 1,
      idempotency_key: "is_ready:candidate_joined",
      payload: {
        candidate_participant_id: "candidate-is-ready",
        room_name: "prelude-is-ready",
        modes: ["audio"],
      },
    });
  });

  it("emits candidate_media_ready after candidate_joined", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          session: {
            id: "is_ready",
            candidate_id: "candidate-demo",
            events: [{ type: "candidate_joined" }],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ duplicate: false }, { status: 202 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({
            type: "candidate_media_ready",
            payload: {
              candidate_participant_id: "candidate-is-ready",
              room_name: "prelude-is-ready",
              audio: true,
              video: false,
              published_tracks: ["microphone"],
            },
          }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const eventRequestInit = fetchMock.mock.calls[1]?.[1];
    expect(eventRequestInit).toBeDefined();
    expect(JSON.parse(String(eventRequestInit?.body))).toMatchObject({
      event_id: "evt_is_ready_candidate_media_ready",
      type: "candidate_media_ready",
      actor: "candidate",
      sequence_number: 2,
      idempotency_key: "is_ready:candidate_media_ready",
      payload: {
        candidate_participant_id: "candidate-is-ready",
        room_name: "prelude-is-ready",
        audio: true,
        video: false,
        published_tracks: ["microphone"],
      },
    });
  });

  it("does not emit a duplicate candidate_joined event", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: {
          id: "is_ready",
          candidate_id: "candidate-demo",
          events: [{ type: "candidate_joined" }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({ type: "candidate_joined" }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    await expect(response.json()).resolves.toEqual({ duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not emit a duplicate candidate_media_ready event", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: {
          id: "is_ready",
          candidate_id: "candidate-demo",
          events: [
            { type: "candidate_joined" },
            { type: "candidate_media_ready" },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({ type: "candidate_media_ready" }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    await expect(response.json()).resolves.toEqual({ duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects candidate_media_ready before candidate_joined", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: {
          id: "is_ready",
          candidate_id: "candidate-demo",
          events: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({ type: "candidate_media_ready" }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "candidate_not_joined" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported candidate events", async () => {
    const response = await POST(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
        {
          method: "POST",
          body: JSON.stringify({ type: "session_started" }),
        },
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "unsupported_event_type" },
    });
  });
});
