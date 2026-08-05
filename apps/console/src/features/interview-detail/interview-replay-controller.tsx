"use client";

import * as React from "react";
import { PlaySolid } from "iconoir-react";

export type ReplayRequest = {
  endMs: number | null;
  id: string;
  label: string;
  startMs: number;
};

export type ReplayPlaybackState = {
  elapsedMs: number;
  isPlaying: boolean;
  totalMs: number;
};

const idlePlayback: ReplayPlaybackState = {
  elapsedMs: 0,
  isPlaying: false,
  totalMs: 0,
};

type InterviewReplayContextValue = {
  closeTranscript: () => void;
  openTranscript: () => void;
  playRange: (range: ReplayRequest) => void;
  // Playhead updates land ten times a second, so playback state is published
  // through a subscription rather than context state: only components that opt
  // in with `useReplayPlayback` re-render.
  publishPlayback: (state: ReplayPlaybackState) => void;
  registerPlayer: (player: ((request: ReplayRequest) => void) | null) => void;
  registerToggle: (toggle: (() => void) | null) => void;
  subscribePlayback: (
    listener: (state: ReplayPlaybackState) => void,
  ) => () => void;
  togglePlayback: () => void;
  transcriptOpen: boolean;
};

const InterviewReplayContext =
  React.createContext<InterviewReplayContextValue | null>(null);

export function InterviewReplayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const playerRef = React.useRef<((request: ReplayRequest) => void) | null>(
    null,
  );
  const toggleRef = React.useRef<(() => void) | null>(null);
  const playbackRef = React.useRef<ReplayPlaybackState>(idlePlayback);
  const listenersRef = React.useRef(
    new Set<(state: ReplayPlaybackState) => void>(),
  );
  const [transcriptOpen, setTranscriptOpen] = React.useState(false);

  const publishPlayback = React.useCallback((state: ReplayPlaybackState) => {
    playbackRef.current = state;
    for (const listener of listenersRef.current) {
      listener(state);
    }
  }, []);

  const subscribePlayback = React.useCallback(
    (listener: (state: ReplayPlaybackState) => void) => {
      listenersRef.current.add(listener);
      listener(playbackRef.current);

      return () => {
        listenersRef.current.delete(listener);
      };
    },
    [],
  );

  const playRange = React.useCallback((range: ReplayRequest) => {
    playerRef.current?.(range);
  }, []);

  const registerPlayer = React.useCallback(
    (player: ((request: ReplayRequest) => void) | null) => {
      playerRef.current = player;
    },
    [],
  );

  const registerToggle = React.useCallback((toggle: (() => void) | null) => {
    toggleRef.current = toggle;
  }, []);

  const togglePlayback = React.useCallback(() => {
    toggleRef.current?.();
  }, []);

  const value = React.useMemo(
    () => ({
      closeTranscript: () => setTranscriptOpen(false),
      openTranscript: () => setTranscriptOpen(true),
      playRange,
      publishPlayback,
      registerPlayer,
      registerToggle,
      subscribePlayback,
      togglePlayback,
      transcriptOpen,
    }),
    [
      playRange,
      publishPlayback,
      registerPlayer,
      registerToggle,
      subscribePlayback,
      togglePlayback,
      transcriptOpen,
    ],
  );

  return (
    <InterviewReplayContext.Provider value={value}>
      {children}
    </InterviewReplayContext.Provider>
  );
}

export function useInterviewReplay() {
  const context = React.useContext(InterviewReplayContext);

  if (!context) {
    throw new Error(
      "useInterviewReplay must be used within InterviewReplayProvider.",
    );
  }

  return context;
}

export function useReplayPlayback() {
  const { subscribePlayback } = useInterviewReplay();
  const [playback, setPlayback] =
    React.useState<ReplayPlaybackState>(idlePlayback);

  React.useEffect(() => subscribePlayback(setPlayback), [subscribePlayback]);

  return playback;
}

export function ReplaySeekButton({
  className,
  label,
  startMs,
}: {
  className: string;
  label: string;
  startMs: number;
}) {
  const { playRange } = useInterviewReplay();

  return (
    <button
      className={className}
      onClick={() =>
        playRange({ endMs: null, id: `moment-${startMs}`, label, startMs })
      }
      type="button"
    >
      <PlaySolid aria-hidden={true} className="h-[13px] w-[13px]" />
      {label}
    </button>
  );
}
