import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

describe("POST /api/live-interview-sessions/[sessionId]/events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

describe("GET /api/live-interview-sessions/[sessionId]/events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("proxies normalized realtime session state for the candidate room", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: {
          id: "is_ready",
          candidate_id: "candidate-demo",
          status: "in_progress",
          events: [
            {
              event_id: "evt_agent_speech_started",
              type: "agent_speech_started",
              actor: "agent",
              sequence_number: 3,
              occurred_at: "2026-06-21T09:00:00Z",
              payload: { question_id: "intro" },
            },
            {
              eventId: "evt_question_asked",
              type: "question_asked",
              actor: "agent",
              sequence: 4,
              occurredAt: "2026-06-21T09:00:02Z",
              payload: {
                transcript_turn: {
                  turn_id: "turn_q1",
                  speaker: "interviewer",
                  text: "Can you introduce yourself?",
                },
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: {
        sessionId: "is_ready",
        status: "in_progress",
        events: [
          {
            eventId: "evt_agent_speech_started",
            sequence: 3,
            type: "agent_speech_started",
            actor: "agent",
            occurredAt: "2026-06-21T09:00:00Z",
            payload: { question_id: "intro" },
          },
          {
            eventId: "evt_question_asked",
            sequence: 4,
            type: "question_asked",
            actor: "agent",
            occurredAt: "2026-06-21T09:00:02Z",
            payload: {
              transcript_turn: {
                turn_id: "turn_q1",
                speaker: "interviewer",
                text: "Can you introduce yourself?",
              },
            },
          },
        ],
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/interview-sessions/is_ready",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );
  });

  it("returns 502 when realtime state is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(null));

    const response = await GET(
      new Request(
        "http://candidate.test/api/live-interview-sessions/is_ready/events",
      ),
      { params: Promise.resolve({ sessionId: "is_ready" }) },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "session_unavailable" },
    });
  });
});
