"use client";

import { PauseSolid, PlaySolid } from "iconoir-react";
import { useEffect, useRef, useState } from "react";

// Structural match of the server CandidateRecording (kept local so this client
// component pulls in no server-only code).
type CandidateRecording = {
  durationMs: number | null;
  status: "available" | "processing" | "failed" | "deleted";
  url: string | null;
};

export function CandidateVoicePlayer({
  fallbackDurationMs,
  recording,
}: {
  fallbackDurationMs: number;
  recording: CandidateRecording | null;
}) {
  if (recording?.status === "available" && recording.url) {
    return (
      <VoicePlayer
        durationMs={recording.durationMs ?? fallbackDurationMs}
        url={recording.url}
      />
    );
  }

  return (
    <VoicePlayerPlaceholder
      status={
        recording?.status === "available"
          ? "playback_unavailable"
          : (recording?.status ?? "none")
      }
    />
  );
}

function VoicePlayer({ durationMs, url }: { durationMs: number; url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState(durationMs);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let animationFrame = 0;
    let lastUpdate = 0;
    const updateProgress = (timestamp: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      // Ten visual updates per second keep the playhead fluid without causing
      // an unnecessary React render on every animation frame.
      if (timestamp - lastUpdate >= 100) {
        setElapsedMs(Math.round(audio.currentTime * 1000));
        lastUpdate = timestamp;
      }
      animationFrame = window.requestAnimationFrame(updateProgress);
    };

    animationFrame = window.requestAnimationFrame(updateProgress);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      if (audio.ended) {
        audio.currentTime = 0;
        setElapsedMs(0);
      }
      setPlaybackError(null);
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
        setPlaybackError(
          "The recording could not be played. Check your connection and retry.",
        );
      }
    } else {
      audio.pause();
    }
  };

  const seekTo = (nextElapsedMs: number) => {
    const audio = audioRef.current;
    if (!audio || totalMs <= 0) {
      return;
    }
    const clampedElapsedMs = Math.min(totalMs, Math.max(0, nextElapsedMs));
    audio.currentTime = clampedElapsedMs / 1000;
    setElapsedMs(clampedElapsedMs);
  };

  const progress = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;

  return (
    <section
      aria-label="Interview recording"
      className="sticky top-[58px] z-[15] scroll-mt-[58px] rounded-[16px] border border-[#e7e2d8] bg-white px-[18px] py-[13px]"
    >
      <audio
        onEnded={() => {
          setElapsedMs(totalMs);
          setIsPlaying(false);
        }}
        onError={() => {
          setIsPlaying(false);
          setPlaybackError(
            "The recording could not be loaded. Refresh the page to request a new secure playback link.",
          );
        }}
        onLoadedMetadata={(event) => {
          const { duration } = event.currentTarget;
          if (Number.isFinite(duration) && duration > 0) {
            setTotalMs(Math.round(duration * 1000));
          }
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) =>
          setElapsedMs(Math.round(event.currentTarget.currentTime * 1000))
        }
        preload="metadata"
        ref={audioRef}
        src={url}
      />
      <div className="flex items-center gap-4">
        <button
          aria-describedby={
            playbackError ? "recording-playback-error" : undefined
          }
          aria-label={isPlaying ? "Pause recording" : "Play recording"}
          className="grid h-[46px] w-[46px] shrink-0 cursor-pointer place-items-center rounded-full border-0 text-white transition hover:bg-[#2a2925] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={() => void togglePlayback()}
          style={{ backgroundColor: "#171612" }}
          type="button"
        >
          {isPlaying ? (
            <PauseSolid aria-hidden={true} className="h-[19px] w-[19px]" />
          ) : (
            <PlaySolid aria-hidden={true} className="h-[19px] w-[19px]" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-ink-950">
              Voice interview
            </p>
            <p className="font-mono text-xs tabular-nums text-[#8a8178]">
              {formatDurationLabel(elapsedMs)} / {formatDurationLabel(totalMs)}
            </p>
          </div>
          <div className="relative mt-2 flex h-[30px] w-full items-center">
            <span className="h-[6px] w-full overflow-hidden rounded-full bg-[#ece8de]">
              <span
                className="block h-full rounded-full bg-olive-700"
                style={{ width: `${progress}%` }}
              />
            </span>
            <span
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
              style={{
                backgroundColor: "#171612",
                left: `calc(${progress}% - 6px)`,
              }}
            />
            <input
              aria-label="Seek recording"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              max={Math.max(totalMs, 1)}
              min={0}
              onChange={(event) => seekTo(Number(event.currentTarget.value))}
              step={250}
              type="range"
              value={Math.min(elapsedMs, Math.max(totalMs, 1))}
            />
          </div>
        </div>
      </div>
      {playbackError ? (
        <p
          className="mt-2 pl-[62px] text-xs leading-5 text-red-700"
          id="recording-playback-error"
          role="alert"
        >
          {playbackError}
        </p>
      ) : null}
    </section>
  );
}

function VoicePlayerPlaceholder({
  status,
}: {
  status: CandidateRecording["status"] | "none" | "playback_unavailable";
}) {
  const message =
    status === "processing"
      ? "Recording is processing — it will appear here shortly."
      : status === "deleted"
        ? "This recording has been deleted and is no longer available."
        : status === "failed"
          ? "Audio recording is unavailable for this interview."
          : status === "playback_unavailable"
            ? "The recording is ready, but secure playback is not configured."
            : "No audio recording for this interview.";

  return (
    <section className="sticky top-[58px] z-[15] flex scroll-mt-[58px] items-center gap-3 rounded-[16px] border border-dashed border-[#e0dacc] bg-white/70 px-[18px] py-[13px]">
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#f0ece2] text-[#a29b8d]">
        <PlaySolid aria-hidden={true} className="h-4 w-4" />
      </span>
      <p className="text-[13px] text-[#7c766b]">{message}</p>
    </section>
  );
}

function formatDurationLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes =
    hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}
