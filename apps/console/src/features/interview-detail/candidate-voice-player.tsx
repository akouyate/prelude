"use client";

import { PauseSolid, PlaySolid, Undo } from "iconoir-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  formatReplayTime,
  type InterviewReplayChapter,
} from "./interview-replay";
import {
  type ReplayRequest,
  useInterviewReplay,
} from "./interview-replay-controller";

const playbackSpeeds = [0.75, 1, 1.25, 1.5, 2];

function nextPlaybackSpeed(speed: number) {
  const index = playbackSpeeds.indexOf(speed);

  return playbackSpeeds[(index + 1) % playbackSpeeds.length] ?? 1;
}

const waveformBarCount = 96;
const skipBackMs = 15_000;

// The waveform is a decorative speech envelope, not a real amplitude read of the
// recording: phrases of 6-14 bars with short pauses between them. It is derived
// from a fixed seed so a given interview always draws the same shape.
function buildWaveform() {
  const bars: number[] = [];
  let seed = 20_260_804;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  while (bars.length < waveformBarCount) {
    const phraseLength = 6 + Math.floor(random() * 9);
    const loudness = 0.42 + random() * 0.58;

    for (
      let index = 0;
      index < phraseLength && bars.length < waveformBarCount;
      index += 1
    ) {
      const arc = Math.sin((index / phraseLength) * Math.PI);
      const syllable =
        0.62 + 0.38 * Math.abs(Math.sin(index * 1.9 + loudness * 4));
      bars.push(Math.max(0.1, loudness * (0.35 + 0.65 * arc) * syllable));
    }

    const pause = 1 + Math.floor(random() * 3);
    for (
      let index = 0;
      index < pause && bars.length < waveformBarCount;
      index += 1
    ) {
      bars.push(0.07 + random() * 0.05);
    }
  }

  return bars;
}

// Deterministic and argument-free: build it once for the module, not per mount.
const waveform = buildWaveform();

// Structural match of the server CandidateRecording (kept local so this client
// component pulls in no server-only code).
type CandidateRecording = {
  durationMs: number | null;
  status: "available" | "processing" | "failed" | "deleted";
  url: string | null;
};

export function CandidateVoicePlayer({
  chapters,
  fallbackDurationMs,
  recording,
}: {
  chapters: InterviewReplayChapter[];
  fallbackDurationMs: number;
  recording: CandidateRecording | null;
}) {
  if (recording?.status === "available" && recording.url) {
    return (
      <VoicePlayer
        chapters={chapters}
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

function VoicePlayer({
  chapters,
  durationMs,
  url,
}: {
  chapters: InterviewReplayChapter[];
  durationMs: number;
  url: string;
}) {
  const { openTranscript, publishPlayback, registerPlayer, registerToggle } =
    useInterviewReplay();
  const { t } = useTranslation();
  /*
   * `playRequest` below is a `useCallback` with empty deps — every caller holds
   * the same function for the life of the player. Adding `t` to those deps
   * would give it a new identity on every locale change; holding it in a ref
   * keeps the callback stable while the message it reads stays current.
   */
  const tRef = useRef(t);
  tRef.current = t;
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  const segmentEndRef = useRef<number | null>(null);
  const totalMsRef = useRef(durationMs);
  const [activeRequest, setActiveRequest] = useState<ReplayRequest | null>(
    null,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState(durationMs);

  useEffect(() => {
    totalMsRef.current = totalMs;
  }, [totalMs]);

  const stopAtSegmentBoundary = useCallback((nextElapsedMs: number) => {
    const audio = audioRef.current;
    const segmentEndMs = segmentEndRef.current;

    if (!audio || segmentEndMs === null || nextElapsedMs < segmentEndMs) {
      return false;
    }

    audio.pause();
    audio.currentTime = segmentEndMs / 1000;
    setElapsedMs(segmentEndMs);
    return true;
  }, []);

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
        const nextElapsedMs = Math.round(audio.currentTime * 1000);
        if (stopAtSegmentBoundary(nextElapsedMs)) {
          return;
        }
        setElapsedMs(nextElapsedMs);
        lastUpdate = timestamp;
      }
      animationFrame = window.requestAnimationFrame(updateProgress);
    };

    animationFrame = window.requestAnimationFrame(updateProgress);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isPlaying, stopAtSegmentBoundary]);

  const playRequest = useCallback((request: ReplayRequest) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const resolvedStartMs = Math.min(
      totalMsRef.current,
      Math.max(0, request.startMs),
    );
    const resolvedEndMs =
      request.endMs === null
        ? null
        : Math.min(
            totalMsRef.current,
            Math.max(resolvedStartMs + 250, request.endMs),
          );

    audio.currentTime = resolvedStartMs / 1000;
    segmentEndRef.current = resolvedEndMs;
    setActiveRequest({ ...request, endMs: resolvedEndMs });
    setElapsedMs(resolvedStartMs);
    setPlaybackError(null);
    void audio.play().catch(() => {
      setIsPlaying(false);
      setPlaybackError(
        tRef.current("recording.playbackFailed"),
      );
    });
  }, []);

  useEffect(() => {
    registerPlayer(playRequest);
    return () => registerPlayer(null);
  }, [playRequest, registerPlayer]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (audio.paused) {
      const activeEndMs = segmentEndRef.current;
      const shouldRestart =
        audio.ended ||
        (activeEndMs !== null &&
          Math.round(audio.currentTime * 1000) >= activeEndMs - 100);
      if (shouldRestart) {
        const nextStartMs = activeRequest?.startMs ?? 0;
        audio.currentTime = nextStartMs / 1000;
        setElapsedMs(nextStartMs);
      }
      setPlaybackError(null);
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
        setPlaybackError(
          t("recording.playbackFailed"),
        );
      }
    } else {
      audio.pause();
    }
  }, [activeRequest, t]);

  useEffect(() => {
    registerToggle(() => void togglePlayback());
    return () => registerToggle(null);
  }, [registerToggle, togglePlayback]);

  const seekTo = (nextElapsedMs: number) => {
    const audio = audioRef.current;
    if (!audio || totalMs <= 0) {
      return;
    }
    const clampedElapsedMs = Math.min(totalMs, Math.max(0, nextElapsedMs));
    segmentEndRef.current = null;
    setActiveRequest(null);
    audio.currentTime = clampedElapsedMs / 1000;
    setElapsedMs(clampedElapsedMs);
  };

  const progress = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
  const playedRatio = progress / 100;

  useEffect(() => {
    publishPlayback({ elapsedMs, isPlaying, totalMs });
  }, [elapsedMs, isPlaying, publishPlayback, totalMs]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  const seekFromPointer = (clientX: number) => {
    const bounds = waveformRef.current?.getBoundingClientRect();

    if (!bounds || bounds.width === 0) {
      return;
    }

    const fraction = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / bounds.width),
    );
    seekTo(fraction * totalMs);
  };

  return (
    <section
      aria-label={t("recording.regionAria")}
      className="sticky top-3 z-[15] mt-[26px] scroll-mt-3 rounded-[999px] border border-[#eae6dc] bg-white/95 py-[7px] pl-[7px] pr-[15px] backdrop-blur max-[680px]:rounded-[18px] max-[680px]:px-3.5 max-[680px]:py-2.5"
    >
      <audio
        onEnded={() => {
          setElapsedMs(totalMs);
          setIsPlaying(false);
        }}
        onError={() => {
          setIsPlaying(false);
          setPlaybackError(
            t("recording.loadFailed"),
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
      <div className="flex items-center gap-3 max-[680px]:flex-wrap max-[680px]:gap-y-2">
        <button
          aria-describedby={
            playbackError ? "recording-playback-error" : undefined
          }
          aria-label={
            isPlaying ? t("recording.pauseAria") : t("recording.playAria")
          }
          className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-full bg-ink-900 text-white transition hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={() => void togglePlayback()}
          type="button"
        >
          {isPlaying ? (
            <PauseSolid aria-hidden={true} className="h-[13px] w-[13px]" />
          ) : (
            <PlaySolid
              aria-hidden={true}
              className="ml-0.5 h-[15px] w-[15px]"
            />
          )}
        </button>
        <button
          aria-label={t("recording.back15")}
          className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-ink-400 transition hover:bg-[#f1efe8] hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={() => seekTo(elapsedMs - skipBackMs)}
          title={t("recording.back15")}
          type="button"
        >
          <Undo aria-hidden={true} className="h-[15px] w-[15px]" />
        </button>

        <div
          aria-label={t("recording.seekAria")}
          className="relative flex h-[26px] min-w-0 flex-1 cursor-pointer items-center justify-between gap-px max-[680px]:order-first max-[680px]:basis-full"
          onClick={(event) => seekFromPointer(event.clientX)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              seekTo(elapsedMs - 5_000);
            }

            if (event.key === "ArrowRight") {
              event.preventDefault();
              seekTo(elapsedMs + 5_000);
            }
          }}
          ref={waveformRef}
          role="slider"
          aria-valuemax={Math.round(totalMs / 1000)}
          aria-valuemin={0}
          aria-valuenow={Math.round(elapsedMs / 1000)}
          tabIndex={0}
        >
          {waveform.map((value, index) => (
            <span
              className={`pointer-events-none min-w-px flex-1 rounded-[1px] ${
                (index + 0.5) / waveform.length <= playedRatio
                  ? "bg-[#8a8178]"
                  : "bg-[#e4e0d4]"
              }`}
              key={index}
              style={{ height: `${Math.max(3, Math.round(value * 22))}px` }}
            />
          ))}
          {chapters.map((chapter) => (
            <span
              className="pointer-events-none absolute -bottom-1 -ml-[1.5px] h-[3px] w-[3px] rounded-full bg-[#cbc4b6]"
              key={chapter.id}
              style={{
                left: `${totalMs > 0 ? (chapter.startMs / totalMs) * 100 : 0}%`,
              }}
              title={`${chapter.label} · ${formatReplayTime(chapter.startMs)}`}
            />
          ))}
          <span
            className="pointer-events-none absolute -bottom-px -ml-[0.75px] -top-px w-[1.5px] rounded-sm bg-ink-900"
            style={{ left: `${progress}%` }}
          />
        </div>

        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-400">
          {formatReplayTime(elapsedMs)}{" "}
          <span className="text-[#d6d1c4]">/</span> {formatReplayTime(totalMs)}
        </span>
        <button
          className={`grid h-[26px] min-w-[42px] shrink-0 cursor-pointer place-items-center rounded-full border px-[9px] font-mono text-[11px] font-medium leading-none tabular-nums transition hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300 ${
            speed === 1
              ? "border-[#eae6dc] text-ink-400"
              : "border-[#cbc4b6] text-ink-700"
          }`}
          onClick={() => setSpeed(nextPlaybackSpeed(speed))}
          title={t("recording.playbackSpeed")}
          type="button"
        >
          {speed}×
        </button>
        <span className="h-[18px] w-px shrink-0 bg-[#eae6dc]" />
        <button
          className="shrink-0 cursor-pointer text-xs font-semibold text-ink-400 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={openTranscript}
          type="button"
        >
          Transcript
        </button>
      </div>
      {playbackError ? (
        <p
          className="mt-2 px-3 text-xs leading-5 text-coral-800"
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
  const { t } = useTranslation();
  const message =
    status === "processing"
      ? t("recording.processing")
      : status === "deleted"
        ? t("recording.deleted")
        : status === "failed"
          ? t("recording.unavailable")
          : status === "playback_unavailable"
            ? t("recording.playbackNotConfigured")
            : t("recording.none");

  return (
    <section className="mt-[26px] flex items-center gap-3 rounded-[999px] border border-dashed border-[#e0dacc] bg-white/70 py-[7px] pl-[7px] pr-[15px] max-[680px]:rounded-[18px] max-[680px]:px-3.5">
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#f0ece2] text-ink-400">
        <PlaySolid aria-hidden={true} className="h-4 w-4" />
      </span>
      <p className="text-[13px] text-[#7c766b]">{message}</p>
    </section>
  );
}
