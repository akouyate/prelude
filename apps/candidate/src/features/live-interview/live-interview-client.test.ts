import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeProductSession,
  connectRoom,
  createSession,
  resumeStorageKey,
  stopLocalStream,
  toCandidateError,
} from "./live-interview-client";
import type { LiveInterviewSession } from "./live-interview-types";

type FakeRoom = {
  emit: (event: string, ...args: unknown[]) => void;
  remoteParticipants: Map<string, unknown>;
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

    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach((handler) => handler(...args));
    }
  }

  return {
    Room,
    RoomEvent: {
      AudioPlaybackStatusChanged: "audioPlaybackStatusChanged",
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
