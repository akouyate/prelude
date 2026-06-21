import type {
  ConnectedRoom,
  LiveInterviewSession,
  LiveTranscriptTurn,
  LiveTranscriptTurnHandler,
  RoomDisconnectedEvent,
} from "./live-interview-types";

const PRELUDE_TRANSCRIPT_TOPIC = "prelude.transcript.v1";
const LIVEKIT_TRANSCRIPTION_TOPIC = "lk.transcription";

export function resumeStorageKey(token: string) {
  return `prelude:candidate-session:${token}`;
}

export async function createSession(input: {
  candidateEmail: string;
  candidateName: string;
  consentAccepted: boolean;
  resumeToken?: string;
  token: string;
  videoEnabled: boolean;
}) {
  const response = await fetch("/api/live-interview-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidateEmail: input.candidateEmail,
      candidateName: input.candidateName,
      candidateToken: input.token,
      consentAccepted: input.consentAccepted,
      resumeToken: input.resumeToken,
      videoEnabled: input.videoEnabled,
    }),
  });

  if (!response.ok) {
    throw new Error("session_unavailable");
  }

  return (await response.json()) as LiveInterviewSession;
}

export async function completeProductSession(session: LiveInterviewSession) {
  if (!session.productSessionId || !session.resumeToken) {
    return;
  }

  await fetch(`/api/candidate-sessions/${session.productSessionId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resumeToken: session.resumeToken }),
  }).catch(() => undefined);
}

export async function fetchLiveTranscript(sessionId: string) {
  const response = await fetch(
    `/api/live-interview-sessions/${sessionId}/transcript`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("transcript_unavailable");
  }

  const payload = (await response.json()) as {
    transcript?: LiveTranscriptTurn[];
  };

  return payload.transcript ?? [];
}

export async function connectRoom({
  session,
  stream,
  onTranscriptTurn,
  onInterviewerJoined,
  onInterviewerReady,
  onDisconnected,
  onAudioPlaybackBlocked,
  onAudioPlaybackReady,
  onRoomConnected,
  onReconnecting,
}: {
  session: LiveInterviewSession;
  stream: MediaStream;
  onTranscriptTurn?: LiveTranscriptTurnHandler;
  onInterviewerJoined: () => void;
  onInterviewerReady: () => void;
  onDisconnected: (event: RoomDisconnectedEvent) => void;
  onAudioPlaybackBlocked: () => void;
  onAudioPlaybackReady: () => void;
  onRoomConnected: () => void;
  onReconnecting: () => void;
}): Promise<ConnectedRoom> {
  if (session.livekit.isMock) {
    onRoomConnected();
    await markCandidateJoined(session, stream);
    await markCandidateMediaReady(session, stream);
    onInterviewerJoined();
    onInterviewerReady();
    onAudioPlaybackReady();
    return {
      disconnect: () => onDisconnected({ intentional: true }),
      startAudio: async () => undefined,
    };
  }

  const { Room, RoomEvent, Track } = await import("livekit-client");
  const room = new Room();
  const remoteAudioElements: HTMLMediaElement[] = [];
  const transcriptDecoder = new TextDecoder();
  let intentionalDisconnect = false;

  const markInterviewerJoined = () => {
    onInterviewerJoined();
  };

  const markInterviewerReady = () => {
    markInterviewerJoined();
    onInterviewerReady();
  };

  const syncInterviewerState = () => {
    if (remoteAudioElements.length > 0) {
      markInterviewerReady();
      return;
    }

    if (room.remoteParticipants.size > 0) {
      markInterviewerJoined();
      return;
    }

    onRoomConnected();
  };

  room.on(RoomEvent.Reconnecting, onReconnecting);
  room.on(RoomEvent.Reconnected, syncInterviewerState);
  room.on(RoomEvent.Disconnected, () =>
    onDisconnected({ intentional: intentionalDisconnect }),
  );
  room.on(RoomEvent.ParticipantConnected, markInterviewerJoined);
  room.on(RoomEvent.ParticipantDisconnected, syncInterviewerState);
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (room.canPlaybackAudio) {
      onAudioPlaybackReady();
    } else {
      onAudioPlaybackBlocked();
    }
  });
  room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
    if (topic !== PRELUDE_TRANSCRIPT_TOPIC) {
      return;
    }

    const turn = decodeRealtimeTranscriptPacket(
      transcriptDecoder.decode(payload),
    );
    if (turn) {
      onTranscriptTurn?.(turn);
    }
  });
  room.registerTextStreamHandler?.(
    LIVEKIT_TRANSCRIPTION_TOPIC,
    (reader, participantInfo) => {
      void reader
        .readAll()
        .then((text) => {
          const turn = livekitTextStreamToTranscriptTurn({
            attributes: reader.info.attributes,
            participantIdentity: participantInfo.identity,
            sessionId: session.sessionId,
            text,
            timestamp: reader.info.timestamp,
          });
          if (turn) {
            onTranscriptTurn?.(turn);
          }
        })
        .catch(() => undefined);
    },
  );
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

    markInterviewerReady();
    const element = track.attach();
    element.autoplay = true;
    element.controls = false;
    element.style.display = "none";
    remoteAudioElements.push(element);
    document.body.appendChild(element);
    void element
      .play()
      .then(onAudioPlaybackReady)
      .catch(onAudioPlaybackBlocked);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((element) => {
      element.remove();
      const index = remoteAudioElements.indexOf(element);
      if (index >= 0) {
        remoteAudioElements.splice(index, 1);
      }
    });
    syncInterviewerState();
  });

  try {
    await room.connect(session.livekit.url, session.livekit.token);
    await Promise.all(
      stream.getTracks().map((track) =>
        room.localParticipant.publishTrack(track, {
          source:
            track.kind === "audio"
              ? Track.Source.Microphone
              : Track.Source.Camera,
        }),
      ),
    );
    onRoomConnected();
    await markCandidateJoined(session, stream);
    await markCandidateMediaReady(session, stream);
    syncInterviewerState();
    if (!room.canPlaybackAudio) {
      onAudioPlaybackBlocked();
    }
  } catch (cause) {
    remoteAudioElements.forEach((element) => element.remove());
    room.disconnect();
    throw cause;
  }

  return {
    startAudio: async () => {
      await room.startAudio();
      await Promise.all(remoteAudioElements.map((element) => element.play()));
      onAudioPlaybackReady();
    },
    disconnect: () => {
      intentionalDisconnect = true;
      remoteAudioElements.forEach((element) => element.remove());
      room.unregisterTextStreamHandler?.(LIVEKIT_TRANSCRIPTION_TOPIC);
      room.disconnect();
    },
  };
}

export function decodeRealtimeTranscriptPacket(
  payload: string,
): LiveTranscriptTurn | null {
  try {
    const parsed = JSON.parse(payload) as {
      type?: unknown;
      transcriptTurn?: unknown;
      transcript_turn?: unknown;
    };
    if (parsed.type !== "transcript_turn") {
      return null;
    }

    return normalizeRealtimeTranscriptTurn(
      parsed.transcriptTurn ?? parsed.transcript_turn,
    );
  } catch {
    return null;
  }
}

function livekitTextStreamToTranscriptTurn({
  attributes,
  participantIdentity,
  sessionId,
  text,
  timestamp,
}: {
  attributes?: Record<string, string>;
  participantIdentity: string;
  sessionId: string;
  text: string;
  timestamp: number;
}): LiveTranscriptTurn | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const segmentId = attributes?.lk_segment_id ?? attributes?.segment_id;
  const isFinal = attributes?.lk_transcription_final !== "false";
  const transcribedTrackId =
    attributes?.lk_transcribed_track_id ?? attributes?.transcribed_track_id;
  const speaker = participantIdentity.startsWith("agent-")
    ? "interviewer"
    : "candidate";
  const startedAt = new Date(normalizeLivekitTimestamp(timestamp)).toISOString();

  return {
    turnId:
      segmentId ??
      `${sessionId}:livekit:${participantIdentity}:${transcribedTrackId ?? startedAt}`,
    sessionId,
    speaker,
    text: normalizedText,
    isFinal,
    startedAt,
    endedAt: isFinal ? startedAt : undefined,
  };
}

function normalizeRealtimeTranscriptTurn(
  input: unknown,
): LiveTranscriptTurn | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const object = input as Record<string, unknown>;
  const turnId = stringField(object, "turnId", "turn_id");
  const sessionId = stringField(object, "sessionId", "session_id");
  const speaker = stringField(object, "speaker");
  const text = stringField(object, "text");
  const startedAt = stringField(object, "startedAt", "started_at");

  if (
    !turnId ||
    !sessionId ||
    !text ||
    !startedAt ||
    (speaker !== "candidate" && speaker !== "interviewer" && speaker !== "system")
  ) {
    return null;
  }

  return {
    turnId,
    sessionId,
    questionId: stringField(object, "questionId", "question_id"),
    speaker,
    text,
    isFinal: booleanField(object, true, "isFinal", "is_final"),
    startedAt,
    endedAt: stringField(object, "endedAt", "ended_at"),
  };
}

function stringField(
  object: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function booleanField(
  object: Record<string, unknown>,
  fallback: boolean,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return fallback;
}

function normalizeLivekitTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return Date.now();
  }

  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

export function stopLocalStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function toCandidateError(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return "Microphone access is required to start the live interview. You can retry after allowing access in your browser.";
  }

  if (cause instanceof Error && cause.message === "session_unavailable") {
    return "We could not prepare the interview room. Please retry in a moment.";
  }

  if (
    cause instanceof Error &&
    cause.message === "candidate_ready_unavailable"
  ) {
    return "We could not notify the interviewer that you are ready. Please retry in a moment.";
  }

  if (
    cause instanceof Error &&
    cause.message === "candidate_media_ready_unavailable"
  ) {
    return "We could not confirm your microphone status. Please retry in a moment.";
  }

  return "We could not join the live interview room. Please check your connection and retry.";
}

async function markCandidateJoined(
  session: LiveInterviewSession,
  stream: MediaStream,
) {
  const response = await fetch(
    `/api/live-interview-sessions/${session.sessionId}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candidate_joined",
        payload: {
          candidate_participant_id: session.livekit.participant,
          room_name: session.livekit.roomName,
          modes: candidateModes(session, stream),
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error("candidate_ready_unavailable");
  }
}

async function markCandidateMediaReady(
  session: LiveInterviewSession,
  stream: MediaStream,
) {
  const media = mediaReadiness(stream);
  const publishedTracks = [
    ...(media.audio ? ["microphone"] : []),
    ...(media.video ? ["camera"] : []),
  ];

  const response = await fetch(
    `/api/live-interview-sessions/${session.sessionId}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candidate_media_ready",
        payload: {
          candidate_participant_id: session.livekit.participant,
          room_name: session.livekit.roomName,
          audio: media.audio,
          video: media.video,
          published_tracks: publishedTracks,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error("candidate_media_ready_unavailable");
  }
}

function candidateModes(session: LiveInterviewSession, stream: MediaStream) {
  const media = mediaReadiness(stream);
  return session.allowedModalities.filter((mode) => {
    if (mode === "audio") {
      return media.audio;
    }
    if (mode === "video") {
      return media.video;
    }
    return true;
  });
}

function mediaReadiness(stream: MediaStream) {
  return {
    audio: stream.getAudioTracks().some((track) => track.readyState === "live"),
    video: stream.getVideoTracks().some((track) => track.readyState === "live"),
  };
}
