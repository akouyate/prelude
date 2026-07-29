"use client";

import * as React from "react";
import { PlaySolid } from "iconoir-react";

import type { InterviewReplayChapter } from "./interview-replay";

export type ReplayRequest = {
  endMs: number | null;
  id: string;
  label: string;
  startMs: number;
};

type InterviewReplayContextValue = {
  playFullInterview: () => void;
  playRange: (range: ReplayRequest) => void;
  registerPlayer: (player: ((request: ReplayRequest) => void) | null) => void;
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

  const playRange = React.useCallback((range: ReplayRequest) => {
    playerRef.current?.(range);
  }, []);

  const registerPlayer = React.useCallback(
    (player: ((request: ReplayRequest) => void) | null) => {
      playerRef.current = player;
    },
    [],
  );

  const playFullInterview = React.useCallback(() => {
    playRange({
      endMs: null,
      id: "full-interview",
      label: "Full interview",
      startMs: 0,
    });
  }, [playRange]);

  const value = React.useMemo(
    () => ({ playFullInterview, playRange, registerPlayer }),
    [playFullInterview, playRange, registerPlayer],
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

export function ReplaySeekButton({
  ariaLabel,
  chapter,
  children,
  className,
  label,
  showIcon = true,
  startMs,
}: {
  ariaLabel?: string;
  chapter?: InterviewReplayChapter;
  children?: React.ReactNode;
  className: string;
  label: string;
  showIcon?: boolean;
  startMs?: number;
}) {
  const { playRange } = useInterviewReplay();
  const resolvedStartMs = chapter?.startMs ?? startMs ?? 0;

  return (
    <button
      aria-label={ariaLabel}
      className={className}
      onClick={() =>
        playRange({
          endMs: chapter?.endMs ?? null,
          id: chapter?.id ?? `moment-${resolvedStartMs}`,
          label: chapter?.label ?? label,
          startMs: resolvedStartMs,
        })
      }
      type="button"
    >
      {children ?? (
        <>
          {showIcon ? (
            <PlaySolid aria-hidden={true} className="h-[13px] w-[13px]" />
          ) : null}
          {label}
        </>
      )}
    </button>
  );
}
