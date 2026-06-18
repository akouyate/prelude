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
            events: []
          }
        })
      )
      .mockResolvedValueOnce(Response.json({ duplicate: false }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-sessions/is_ready/events", {
        method: "POST",
        body: JSON.stringify({
          type: "candidate_joined",
          payload: { media: { audio: true, video: false } }
        })
      }),
      { params: Promise.resolve({ sessionId: "is_ready" }) }
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
      payload: { media: { audio: true, video: false } }
    });
  });

  it("does not emit a duplicate candidate_joined event", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        session: {
          id: "is_ready",
          candidate_id: "candidate-demo",
          events: [{ type: "candidate_joined" }]
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://candidate.test/api/live-interview-sessions/is_ready/events", {
        method: "POST",
        body: JSON.stringify({ type: "candidate_joined" })
      }),
      { params: Promise.resolve({ sessionId: "is_ready" }) }
    );

    await expect(response.json()).resolves.toEqual({ duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
