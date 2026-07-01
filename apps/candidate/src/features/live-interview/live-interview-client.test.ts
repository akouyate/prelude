import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeProductSession,
  connectRoom,
  consumeTranscriptionStream,
  createSession,
  fetchLiveSessionState,
  decodeRealtimeTranscriptPacket,
  fetchLiveTranscript,
  markProductSessionLifecycle,
  resumeStorageKey,
  stopLocalStream,
  toCandidateError,
} from "./live-interview-client";
import type { LiveInterviewSession } from "./live-interview-types";

type FakeTextStreamReader = {
  info: {
    attributes?: Record<string, string>;
    timestamp: number;
  };
  [Symbol.asyncIterator](): AsyncIterator<string>;
};

type FakeTextStreamHandler = (
  reader: FakeTextStreamReader,
  participantInfo: { identity: string },
) => void;

// Mirrors a LiveKit TextStreamReader: an async-iterable that yields each delta
// chunk (the synchronized agent transcription arrives paced to the audio).
function textStreamReader({
  attributes,
  chunks,
  timestamp,
}: {
  attributes?: Record<string, string>;
  chunks: string[];
  timestamp: number;
}): FakeTextStreamReader {
  return {
    info: { attributes, timestamp },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

type FakeRoom = {
  emit: (event: string, ...args: unknown[]) => void;
  remoteParticipants: Map<string, unknown>;
  textStreamHandlers: Map<string, FakeTextStreamHandler>;
};

const livekitMock = vi.hoisted(() => ({
  room: null as FakeRoom | null,
}));

vi.mock("livekit-client", () => {
  class Room {
    canPlaybackAudio = true;
    localParticipant = {
      publishTrack: vi.fn(),
    };
    remoteParticipants = new Map<string, unknown>();
    textStreamHandlers = new Map();
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor() {
      livekitMock.room = this;
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    async connect() {
      return undefined;
    }

    disconnect() {
      this.emit("disconnected");
    }

    registerTextStreamHandler(topic: string, handler: FakeTextStreamHandler) {
      this.textStreamHandlers.set(topic, handler);
    }

    unregisterTextStreamHandler(topic: string) {
      this.textStreamHandlers.delete(topic);
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach((handler) => handler(...args));
    }
  }

  return {
    Room,
    RoomEvent: {
      AudioPlaybackStatusChanged: "audioPlaybackStatusChanged",
      DataReceived: "dataReceived",
      Disconnected: "disconnected",
      ParticipantConnected: "participantConnected",
      ParticipantDisconnected: "participantDisconnected",
      Reconnected: "reconnected",
      Reconnecting: "reconnecting",
      TrackSubscribed: "trackSubscribed",
      TrackUnsubscribed: "trackUnsubscribed",
    },
    Track: {
      Kind: {
        Audio: "audio",
      },
      Source: {
        Camera: "camera",
        Microphone: "microphone",
      },
    },
  };
});

describe("live interview client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    livekitMock.room = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a candidate session with the expected API payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        ...sessionFixture(),
        allowedModalities: ["audio"],
      }),
    );

    const session = await createSession({
      candidateEmail: "ada@example.com",
      candidateName: "Ada Lovelace",
      consentAccepted: true,
      resumeToken: "resume_existing",
      token: "public_token",
      videoEnabled: false,
    });

    expect(session.allowedModalities).toEqual(["audio"]);
    expect(fetch).toHaveBeenCalledWith("/api/live-interview-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateEmail: "ada@example.com",
        candidateName: "Ada Lovelace",
        candidateToken: "public_token",
        consentAccepted: true,
        resumeToken: "resume_existing",
        videoEnabled: false,
      }),
    });
  });

  it("preserves candidate lifecycle error codes from the session API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      errorResponse("candidate_session_expired", 410),
    );

    await expect(
      createSession({
        candidateEmail: "ada@example.com",
        candidateName: "Ada Lovelace",
        consentAccepted: true,
        resumeToken: "resume_expired",
        token: "public_token",
        videoEnabled: false,
      }),
    ).rejects.toThrow("candidate_session_expired");
  });

  it("announces candidate readiness when connecting to a mock room", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onRoomConnected = vi.fn();
    const onInterviewerJoined = vi.fn();
    const onInterviewerReady = vi.fn();
    const onDisconnected = vi.fn();
    const onAudioPlaybackReady = vi.fn();

    const room = await connectRoom({
      session: sessionFixture(),
      stream: mediaStreamFixture({ audio: true, video: false }),
      onAudioPlaybackBlocked: vi.fn(),
      onAudioPlaybackReady,
      onInterviewerJoined,
      onInterviewerReady,
      onDisconnected,
      onRoomConnected,
      onReconnecting: vi.fn(),
    });

    expect(onRoomConnected).toHaveBeenCalledOnce();
    expect(onInterviewerJoined).toHaveBeenCalledOnce();
    expect(onInterviewerReady).toHaveBeenCalledOnce();
    expect(onAudioPlaybackReady).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/live-interview-sessions/is_123/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "candidate_joined",
          payload: {
            candidate_participant_id: "candidate-cs_123",
            room_name: "prelude-is_123",
            modes: ["audio"],
          },
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/live-interview-sessions/is_123/events",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "candidate_media_ready",
          payload: {
            candidate_participant_id: "candidate-cs_123",
            room_name: "prelude-is_123",
            audio: true,
            video: false,
            published_tracks: ["microphone"],
          },
        }),
      }),
    );

    room.disconnect();
    expect(onDisconnected).toHaveBeenCalledWith({ intentional: true });
  });

  it("maps real LiveKit room events to candidate room states", async () => {
    const remoteAudioElement = {
      autoplay: false,
      controls: true,
      play: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn(),
      style: { display: "" },
    };
    vi.stubGlobal("document", {
      body: {
        appendChild: vi.fn(),
      },
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onRoomConnected = vi.fn();
    const onInterviewerJoined = vi.fn();
    const onInterviewerReady = vi.fn();
    const onReconnecting = vi.fn();
    const onDisconnected = vi.fn();
    const onAudioPlaybackReady = vi.fn();

    const room = await connectRoom({
      session: sessionFixture({
        livekit: {
          ...sessionFixture().livekit,
          isMock: false,
        },
      }),
      stream: mediaStreamFixture({ audio: true, video: false }),
      onAudioPlaybackBlocked: vi.fn(),
      onAudioPlaybackReady,
      onInterviewerJoined,
      onInterviewerReady,
      onDisconnected,
      onReconnecting,
      onRoomConnected,
    });

    expect(onRoomConnected).toHaveBeenCalled();
    expect(onInterviewerReady).not.toHaveBeenCalled();

    livekitMock.room?.remoteParticipants.set("agent-is_123", {});
    livekitMock.room?.emit("participantConnected");
    expect(onInterviewerJoined).toHaveBeenCalled();

    livekitMock.room?.emit("trackSubscribed", {
      attach: () => remoteAudioElement,
      kind: "audio",
    });
    await vi.waitFor(() => expect(onInterviewerReady).toHaveBeenCalled());
    expect(onAudioPlaybackReady).toHaveBeenCalled();

    livekitMock.room?.emit("reconnecting");
    expect(onReconnecting).toHaveBeenCalledOnce();
    livekitMock.room?.emit("reconnected");
    expect(onInterviewerReady).toHaveBeenCalledTimes(2);

    livekitMock.room?.emit("disconnected");
    expect(onDisconnected).toHaveBeenCalledWith({ intentional: false });

    room.disconnect();
    expect(onDisconnected).toHaveBeenCalledWith({ intentional: true });
  });

  it("pushes realtime transcript turns received from LiveKit data packets", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onTranscriptTurn = vi.fn();

    await connectRoom({
      session: sessionFixture({
        livekit: {
          ...sessionFixture().livekit,
          isMock: false,
        },
      }),
      stream: mediaStreamFixture({ audio: true, video: false }),
      onAudioPlaybackBlocked: vi.fn(),
      onAudioPlaybackReady: vi.fn(),
      onDisconnected: vi.fn(),
      onInterviewerJoined: vi.fn(),
      onInterviewerReady: vi.fn(),
      onReconnecting: vi.fn(),
      onRoomConnected: vi.fn(),
      onTranscriptTurn,
    });

    livekitMock.room?.emit(
      "dataReceived",
      new TextEncoder().encode(
        JSON.stringify({
          type: "transcript_turn",
          transcriptTurn: {
            turnId: "turn_1",
            sessionId: "is_123",
            speaker: "interviewer",
            text: "Can you introduce yourself?",
            isFinal: true,
            startedAt: "2026-06-21T09:00:00Z",
          },
        }),
      ),
      {},
      "reliable",
      "prelude.transcript.v1",
    );

    expect(onTranscriptTurn).toHaveBeenCalledWith({
      turnId: "turn_1",
      sessionId: "is_123",
      speaker: "interviewer",
      text: "Can you introduce yourself?",
      isFinal: true,
      startedAt: "2026-06-21T09:00:00Z",
    });
  });

  it("reveals interviewer transcription progressively, synced to the voice", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onTranscriptTurn = vi.fn();
    const onInterviewerCaption = vi.fn();

    await connectRoom({
      session: sessionFixture({
        livekit: {
          ...sessionFixture().livekit,
          isMock: false,
        },
      }),
      stream: mediaStreamFixture({ audio: true, video: false }),
      onAudioPlaybackBlocked: vi.fn(),
      onAudioPlaybackReady: vi.fn(),
      onDisconnected: vi.fn(),
      onInterviewerCaption,
      onInterviewerJoined: vi.fn(),
      onInterviewerReady: vi.fn(),
      onReconnecting: vi.fn(),
      onRoomConnected: vi.fn(),
      onTranscriptTurn,
    });

    livekitMock.room?.textStreamHandlers.get("lk.transcription")?.(
      textStreamReader({
        attributes: {
          lk_segment_id: "segment_1",
          lk_transcribed_track_id: "track_1",
          lk_transcription_final: "true",
        },
        chunks: [" Can you", " introduce", " yourself? "],
        timestamp: 1_780_000_000,
      }),
      { identity: "agent-is_123" },
    );

    // Each delta grows the live caption: the on-screen text tracks the voice.
    await vi.waitFor(() =>
      expect(onInterviewerCaption).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: "Can you introduce yourself?",
          isFinal: true,
        }),
      ),
    );
    expect(
      onInterviewerCaption.mock.calls.map(([caption]) => ({
        isFinal: caption.isFinal,
        text: caption.text,
      })),
    ).toEqual([
      { isFinal: false, text: "Can you" },
      { isFinal: false, text: "Can you introduce" },
      { isFinal: false, text: "Can you introduce yourself?" },
      { isFinal: true, text: "Can you introduce yourself?" },
    ]);

    // The finalized turn still lands exactly once, for the recruiter history.
    expect(onTranscriptTurn).toHaveBeenCalledTimes(1);
    expect(onTranscriptTurn).toHaveBeenCalledWith({
      turnId: "segment_1",
      sessionId: "is_123",
      speaker: "interviewer",
      text: "Can you introduce yourself?",
      isFinal: true,
      startedAt: "2026-05-28T20:26:40.000Z",
      endedAt: "2026-05-28T20:26:40.000Z",
    });
  });

  it("never publishes a live caption for the candidate's own speech", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onTranscriptTurn = vi.fn();
    const onInterviewerCaption = vi.fn();

    await connectRoom({
      session: sessionFixture({
        livekit: {
          ...sessionFixture().livekit,
          isMock: false,
        },
      }),
      stream: mediaStreamFixture({ audio: true, video: false }),
      onAudioPlaybackBlocked: vi.fn(),
      onAudioPlaybackReady: vi.fn(),
      onDisconnected: vi.fn(),
      onInterviewerCaption,
      onInterviewerJoined: vi.fn(),
      onInterviewerReady: vi.fn(),
      onReconnecting: vi.fn(),
      onRoomConnected: vi.fn(),
      onTranscriptTurn,
    });

    livekitMock.room?.textStreamHandlers.get("lk.transcription")?.(
      textStreamReader({
        attributes: { lk_segment_id: "c_seg" },
        chunks: ["I have", " relevant", " experience."],
        timestamp: 1_780_000_000,
      }),
      { identity: "candidate-cs_123" },
    );

    await vi.waitFor(() => expect(onTranscriptTurn).toHaveBeenCalledTimes(1));
    expect(onInterviewerCaption).not.toHaveBeenCalled();
    expect(onTranscriptTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        speaker: "candidate",
        text: "I have relevant experience.",
        isFinal: true,
      }),
    );
  });

  it("accumulates transcription deltas into a growing caption", async () => {
    const onCaption = vi.fn();
    const onTurn = vi.fn();

    await consumeTranscriptionStream({
      reader: textStreamReader({
        attributes: { lk_segment_id: "seg", lk_transcription_final: "true" },
        chunks: ["Bonjour", " et", " bienvenue."],
        timestamp: 1_780_000_000,
      }),
      participantIdentity: "agent-is_9",
      sessionId: "is_9",
      onCaption,
      onTurn,
    });

    expect(onCaption.mock.calls.map(([caption]) => caption.text)).toEqual([
      "Bonjour",
      "Bonjour et",
      "Bonjour et bienvenue.",
      "Bonjour et bienvenue.",
    ]);
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ isFinal: true, text: "Bonjour et bienvenue." }),
    );
  });

  it("ignores malformed realtime transcript packets", () => {
    expect(decodeRealtimeTranscriptPacket("{")).toBeNull();
    expect(
      decodeRealtimeTranscriptPacket(JSON.stringify({ type: "other" })),
    ).toBeNull();
  });

  it("completes resumable product sessions without blocking the UI", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    await expect(
      completeProductSession(sessionFixture()),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/candidate-sessions/cs_123/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeToken: "resume_123" }),
      },
    );
  });

  it("marks product sessions abandoned or failed without blocking the UI", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    await expect(
      markProductSessionLifecycle(sessionFixture(), "abandon"),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/candidate-sessions/cs_123/lifecycle",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "abandon",
          resumeToken: "resume_123",
        }),
      },
    );
  });

  it("loads normalized live transcript turns", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        transcript: [
          {
            turnId: "turn_1",
            sessionId: "is_123",
            speaker: "interviewer",
            text: "Can you introduce yourself?",
            isFinal: true,
            startedAt: "2026-06-21T09:00:00Z",
          },
        ],
      }),
    );

    await expect(fetchLiveTranscript("is_123")).resolves.toEqual([
      {
        turnId: "turn_1",
        sessionId: "is_123",
        speaker: "interviewer",
        text: "Can you introduce yourself?",
        isFinal: true,
        startedAt: "2026-06-21T09:00:00Z",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/live-interview-sessions/is_123/transcript",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );
  });

  it("loads live session runtime state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        session: {
          sessionId: "is_123",
          status: "in_progress",
          events: [
            {
              eventId: "evt_1",
              sequence: 1,
              type: "agent_joined",
              actor: "agent",
              occurredAt: "2026-06-21T09:00:00Z",
              payload: {},
            },
          ],
        },
      }),
    );

    await expect(fetchLiveSessionState("is_123")).resolves.toEqual({
      sessionId: "is_123",
      status: "in_progress",
      events: [
        {
          eventId: "evt_1",
          sequence: 1,
          type: "agent_joined",
          actor: "agent",
          occurredAt: "2026-06-21T09:00:00Z",
          payload: {},
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/live-interview-sessions/is_123/events",
      {
        headers: { accept: "application/json" },
        cache: "no-store",
      },
    );
  });

  it("stops every local media track", () => {
    const audioTrack = { stop: vi.fn() };
    const videoTrack = { stop: vi.fn() };

    stopLocalStream({
      getTracks: () => [audioTrack, videoTrack],
    } as unknown as MediaStream);

    expect(audioTrack.stop).toHaveBeenCalledOnce();
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });

  it("maps low-level failures to candidate-facing messages", () => {
    expect(resumeStorageKey("public_token")).toBe(
      "prelude:candidate-session:public_token",
    );
    expect(toCandidateError(new Error("session_unavailable"))).toContain(
      "prepare the interview room",
    );
    expect(toCandidateError(new Error("candidate_session_expired"))).toContain(
      "link has expired",
    );
    expect(
      toCandidateError(new Error("candidate_session_already_completed")),
    ).toContain("already been completed");
    expect(
      toCandidateError(new Error("candidate_session_superseded")),
    ).toContain("replaced by a newer one");
    expect(toCandidateError(new Error("realtime_api_failed"))).toContain(
      "live interviewer is not available",
    );
    expect(
      toCandidateError(new Error("candidate_media_ready_unavailable")),
    ).toContain("confirm your microphone status");
    expect(toCandidateError(new Error("other"))).toContain(
      "join the live interview room",
    );
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function errorResponse(code: string, status: number) {
  return new Response(JSON.stringify({ error: { code } }), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function sessionFixture(
  overrides: Partial<LiveInterviewSession> = {},
): LiveInterviewSession {
  return {
    sessionId: "is_123",
    productSessionId: "cs_123",
    resumeToken: "resume_123",
    allowedModalities: ["audio", "video"],
    livekit: {
      roomName: "prelude-is_123",
      url: "wss://livekit.test",
      token: "lk_token",
      participant: "candidate-cs_123",
      expiresAt: "2026-06-20T12:00:00.000Z",
      isMock: true,
    },
    ...overrides,
  };
}

function mediaStreamFixture({
  audio,
  video,
}: {
  audio: boolean;
  video: boolean;
}) {
  const audioTracks = audio ? [{ readyState: "live" }] : [];
  const videoTracks = video ? [{ readyState: "live" }] : [];

  return {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...audioTracks, ...videoTracks],
  } as unknown as MediaStream;
}
