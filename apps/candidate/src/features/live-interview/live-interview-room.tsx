"use client";

import * as React from "react";
import { Button } from "@prelude/ui";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Mic,
  Pause,
  PhoneOff,
  RefreshCcw,
  ShieldCheck,
  Video,
} from "lucide-react";

type RoomStatus =
  | "ready"
  | "preparing"
  | "permission_required"
  | "connecting"
  | "interviewer_joining"
  | "connected"
  | "reconnecting"
  | "failed"
  | "completed";

type LiveInterviewSession = {
  sessionId: string;
  allowedModalities: Array<"audio" | "video" | "form">;
  livekit: {
    roomName: string;
    url: string;
    token: string;
    participant: string;
    expiresAt: string;
    isMock: boolean;
  };
};

type ConnectedRoom = {
  disconnect: () => void;
  startAudio: () => Promise<void>;
};

const statusCopy: Record<RoomStatus, string> = {
  ready: "Ready",
  preparing: "Preparing",
  permission_required: "Permission required",
  connecting: "Connecting",
  interviewer_joining: "Interviewer joining",
  connected: "Live",
  reconnecting: "Reconnecting",
  failed: "Failed",
  completed: "Completed",
};

export function LiveInterviewRoom({ token }: { token: string }) {
  const [status, setStatus] = React.useState<RoomStatus>("ready");
  const [session, setSession] = React.useState<LiveInterviewSession | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = React.useState(true);
  const [isAudioPlaybackBlocked, setIsAudioPlaybackBlocked] =
    React.useState(false);
  const [localStream, setLocalStream] = React.useState<MediaStream | null>(
    null,
  );
  const roomRef = React.useRef<ConnectedRoom | null>(null);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const startInFlightRef = React.useRef(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    localStreamRef.current = localStream;
    if (videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  React.useEffect(() => {
    return () => {
      stopLocalStream(localStreamRef.current);
      roomRef.current?.disconnect();
    };
  }, []);

  const startInterview = React.useCallback(async () => {
    if (startInFlightRef.current) {
      return;
    }

    startInFlightRef.current = true;
    let grantedStream: MediaStream | null = null;

    setError(null);
    setIsAudioPlaybackBlocked(false);
    setStatus("preparing");

    try {
      const nextSession = await createSession(token, isVideoEnabled);
      setSession(nextSession);

      setStatus("permission_required");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          nextSession.allowedModalities.includes("video") && isVideoEnabled,
      });
      grantedStream = stream;
      setLocalStream(stream);

      setStatus("connecting");
      roomRef.current = await connectRoom({
        session: nextSession,
        stream,
        onReconnecting: () => setStatus("reconnecting"),
        onConnected: () => setStatus("interviewer_joining"),
        onReady: () => setStatus("interviewer_joining"),
        onDisconnected: () => setStatus("completed"),
        onAudioPlaybackBlocked: () => setIsAudioPlaybackBlocked(true),
        onAudioPlaybackReady: () => {
          setIsAudioPlaybackBlocked(false);
          setStatus((currentStatus) =>
            currentStatus === "interviewer_joining" ||
            currentStatus === "reconnecting"
              ? "connected"
              : currentStatus,
          );
        },
      });
    } catch (cause) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      stopLocalStream(grantedStream);
      setLocalStream(null);
      setStatus("failed");
      setError(toCandidateError(cause));
    } finally {
      startInFlightRef.current = false;
    }
  }, [isVideoEnabled, token]);

  const endInterview = React.useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    stopLocalStream(localStream);
    setLocalStream(null);
    setIsAudioPlaybackBlocked(false);
    setStatus("completed");
  }, [localStream]);

  const enableAudio = React.useCallback(async () => {
    try {
      await roomRef.current?.startAudio();
      setIsAudioPlaybackBlocked(false);
    } catch {
      setIsAudioPlaybackBlocked(true);
    }
  }, []);

  const isBusy =
    status === "preparing" ||
    status === "permission_required" ||
    status === "connecting";
  const isRoomActive =
    status === "interviewer_joining" ||
    status === "connected" ||
    status === "reconnecting";

  return (
    <section className="flex flex-1 flex-col justify-between">
      <div>
        <div className="inline-flex items-center gap-2 rounded-sm bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
          <ShieldCheck aria-hidden="true" className="h-4 w-4" />
          Private live interview
        </div>
        <h1 className="mt-8 text-3xl font-semibold leading-tight">
          Meet your Prelude IA interviewer.
        </h1>
        <p className="mt-4 text-base leading-7 text-white/72">
          Speak naturally. The recruiter reviews your answers, not your face,
          accent, tone, or emotion.
        </p>
      </div>

      <div className="mt-8 space-y-4">
        <div className="rounded-lg bg-white p-4 text-ink-900 shadow-soft">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Live room</p>
              <p className="mt-1 text-sm text-ink-600">
                {session?.livekit.roomName ??
                  "Session will be created when you start."}
              </p>
            </div>
            <StatusPill status={status} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <Capability active icon={Mic} label="Microphone" />
            <Capability active={isVideoEnabled} icon={Camera} label="Camera" />
          </div>

          {status === "ready" ? (
            <label className="mt-4 flex items-center justify-between rounded-md border border-ink-200 px-3 py-3 text-sm">
              <span>
                <span className="block font-medium text-ink-900">
                  Enable video
                </span>
                <span className="block text-ink-600">
                  Audio stays available either way.
                </span>
              </span>
              <input
                checked={isVideoEnabled}
                className="h-5 w-5 accent-ink-900"
                onChange={(event) => setIsVideoEnabled(event.target.checked)}
                type="checkbox"
              />
            </label>
          ) : null}

          {localStream ? (
            <div className="mt-4 overflow-hidden rounded-md bg-ink-900">
              <video
                ref={videoRef}
                aria-label="Local camera preview"
                autoPlay
                className="aspect-video w-full object-cover"
                muted
                playsInline
              />
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex gap-2 rounded-md bg-coral-100 p-3 text-sm text-ink-900">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-coral-500"
              />
              <p>{error}</p>
            </div>
          ) : null}

          {isAudioPlaybackBlocked ? (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-ink-900">
              <p className="font-medium">Audio paused by your browser</p>
              <p className="mt-1 text-ink-600">
                Tap once to hear the interviewer on this device.
              </p>
              <Button
                className="mt-3 w-full"
                onClick={enableAudio}
                variant="secondary"
              >
                <Mic aria-hidden="true" className="h-4 w-4" />
                Enable audio
              </Button>
            </div>
          ) : null}

          <div className="mt-5 flex gap-2">
            {isRoomActive ? (
              <>
                <Button className="flex-1" onClick={endInterview}>
                  <PhoneOff aria-hidden="true" className="h-4 w-4" />
                  End
                </Button>
                <Button className="w-12 px-0" disabled variant="secondary">
                  <Pause aria-hidden="true" className="h-4 w-4" />
                  <span className="sr-only">Pause</span>
                </Button>
              </>
            ) : (
              <Button
                className="w-full"
                disabled={isBusy}
                onClick={startInterview}
              >
                {isBusy ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                  />
                ) : (
                  <Video aria-hidden="true" className="h-4 w-4" />
                )}
                Start live interview
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/6 p-4 text-sm text-white/72">
          <p className="font-medium text-white">Current question</p>
          <p className="mt-2 leading-6">
            Bonjour, pouvez-vous vous présenter brièvement et expliquer ce qui
            vous intéresse dans ce poste ?
          </p>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: RoomStatus }) {
  const isLive = status === "connected";
  const isReconnecting = status === "reconnecting";
  const Icon = isLive ? CheckCircle2 : isReconnecting ? RefreshCcw : Mic;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-800">
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {statusCopy[status]}
    </span>
  );
}

function Capability({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-ink-200 px-3 py-2">
      <Icon aria-hidden={true} className="h-4 w-4 text-ink-700" />
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-xs text-ink-500">
        {active ? "On" : "Off"}
      </span>
    </div>
  );
}

async function createSession(token: string, videoEnabled: boolean) {
  const response = await fetch("/api/live-interview-sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateToken: token, videoEnabled }),
  });

  if (!response.ok) {
    throw new Error("session_unavailable");
  }

  return (await response.json()) as LiveInterviewSession;
}

async function connectRoom({
  session,
  stream,
  onConnected,
  onDisconnected,
  onAudioPlaybackBlocked,
  onAudioPlaybackReady,
  onReady,
  onReconnecting,
}: {
  session: LiveInterviewSession;
  stream: MediaStream;
  onConnected: () => void;
  onDisconnected: () => void;
  onAudioPlaybackBlocked: () => void;
  onAudioPlaybackReady: () => void;
  onReady: () => void;
  onReconnecting: () => void;
}): Promise<ConnectedRoom> {
  if (session.livekit.isMock) {
    onConnected();
    await markCandidateJoined(session, stream);
    await markCandidateMediaReady(session, stream);
    onReady();
    onAudioPlaybackReady();
    return {
      disconnect: onDisconnected,
      startAudio: async () => undefined,
    };
  }

  const { Room, RoomEvent, Track } = await import("livekit-client");
  const room = new Room();
  const remoteAudioElements: HTMLMediaElement[] = [];
  room.on(RoomEvent.Reconnecting, onReconnecting);
  room.on(RoomEvent.Reconnected, onConnected);
  room.on(RoomEvent.Disconnected, onDisconnected);
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (room.canPlaybackAudio) {
      onAudioPlaybackReady();
    } else {
      onAudioPlaybackBlocked();
    }
  });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

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
    onConnected();
    await markCandidateJoined(session, stream);
    await markCandidateMediaReady(session, stream);
    if (!room.canPlaybackAudio) {
      onAudioPlaybackBlocked();
    }
    onReady();
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
      remoteAudioElements.forEach((element) => element.remove());
      room.disconnect();
    },
  };
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

function stopLocalStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function toCandidateError(cause: unknown) {
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
