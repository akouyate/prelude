"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { PauseSolid, PlaySolid, Search, Sparks, Xmark } from "iconoir-react";
import { Drawer } from "@prelude/ui";

import { formatReplayTime } from "./interview-replay";
import {
  useInterviewReplay,
  useReplayPlayback,
} from "./interview-replay-controller";

export type TranscriptDrawerTurn = {
  offsetMs: number;
  speaker: "candidate" | "interviewer" | "system";
  speakerLabel: string;
  text: string;
  turnId: string;
};

export function CandidateTranscriptDrawer({
  candidateInitials,
  turns,
}: {
  candidateInitials: string;
  turns: TranscriptDrawerTurn[];
}) {
  const { t } = useTranslation();
  const { closeTranscript, transcriptOpen } = useInterviewReplay();

  return (
    <Drawer.Root
      onOpenChange={(open) => {
        if (!open) {
          closeTranscript();
        }
      }}
      open={transcriptOpen}
    >
      <Drawer.Portal>
        {/* Enter and exit motion runs off Base UI's data-starting-style /
            data-ending-style hooks, so the panel animates out before unmounting. */}
        <Drawer.Backdrop className="fixed inset-0 z-[60] bg-[rgba(20,18,12,0.32)] backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        {/* Tailwind v4 drives translate utilities through the `translate`
            property, not `transform` — the transition has to name it. */}
        <Drawer.Popup className="fixed inset-y-0 right-0 z-[61] flex w-[min(540px,96vw)] flex-col border-l border-[#e7e2d8] bg-[#fbf9f6] shadow-[-24px_0_60px_rgba(20,18,12,0.16)] outline-none transition-[translate] duration-[340ms] ease-[cubic-bezier(.22,.7,.3,1)] data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full motion-reduce:transition-none">
          <TranscriptPanel
            candidateInitials={candidateInitials}
            turns={turns}
          />
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Split out so the playhead subscription only runs while the drawer is open —
// it ticks ten times a second and would otherwise re-render every turn.
function TranscriptPanel({
  candidateInitials,
  turns,
}: {
  candidateInitials: string;
  turns: TranscriptDrawerTurn[];
}) {
  const { t } = useTranslation();
  const { closeTranscript, playRange, togglePlayback } = useInterviewReplay();
  const { elapsedMs, isPlaying, totalMs } = useReplayPlayback();
  const [query, setQuery] = React.useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTurns = normalizedQuery
    ? turns.filter((turn) => turn.text.toLowerCase().includes(normalizedQuery))
    : turns;
  const activeTurnId = normalizedQuery
    ? null
    : activeTurnIdAt(turns, elapsedMs);

  return (
    <>
      <div className="shrink-0 border-b border-[#e7e2d8] px-[22px] pb-3.5 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Drawer.Title className="font-title text-lg font-semibold tracking-[-0.015em] text-ink-950">
              Transcript
            </Drawer.Title>
            <Drawer.Description className="mt-1.5 text-[12.5px] text-[#8a8178]">
              {turns.length} turns · {formatReplayTime(totalMs)} ·
              auto-transcribed
            </Drawer.Description>
          </div>
          <button
            aria-label={t("recording.closeTranscript")}
            className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-full border border-[#e7e2d8] bg-white text-ink-600 transition hover:border-ink-900 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
            onClick={closeTranscript}
            type="button"
          >
            <Xmark aria-hidden={true} className="h-[17px] w-[17px]" />
          </button>
        </div>
        <div className="mt-3.5 flex h-[38px] items-center gap-2.5 rounded-lg border border-[#e7e2d8] bg-white px-3">
          <Search
            aria-hidden={true}
            className="h-[15px] w-[15px] shrink-0 text-ink-400"
          />
          <input
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink-950 outline-none"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("recording.searchConversation")}
            value={query}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-[#e7e2d8] bg-white px-[22px] py-3">
        <button
          aria-label={isPlaying ? t("recording.pauseAria") : t("recording.playAria")}
          className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-full bg-ink-900 text-white transition hover:bg-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-300"
          onClick={togglePlayback}
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
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e4e0d4]">
          <span
            className="block h-full rounded-full bg-[#8a8178]"
            style={{
              width: `${totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0}%`,
            }}
          />
        </span>
        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-400">
          {formatReplayTime(elapsedMs)}{" "}
          <span className="text-[#d6d1c4]">/</span> {formatReplayTime(totalMs)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-7 pt-2.5">
        {visibleTurns.length === 0 ? (
          <p className="px-3 py-10 text-center text-[13px] text-[#8a8178]">
            No turn matches this search.
          </p>
        ) : null}
        {visibleTurns.map((turn) => {
          const active = turn.turnId === activeTurnId;

          return (
            <button
              className={`flex w-full cursor-pointer gap-3 rounded-xl border px-3 py-3.5 text-left transition hover:bg-white ${
                active
                  ? "border-[#e7e2d8] bg-white"
                  : "border-transparent bg-transparent"
              }`}
              key={turn.turnId}
              onClick={() =>
                playRange({
                  endMs: null,
                  id: turn.turnId,
                  label: turn.speakerLabel,
                  startMs: turn.offsetMs,
                })
              }
              title={t("recording.playFromHere")}
              type="button"
            >
              {turn.speaker === "candidate" ? (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef0e3] font-title text-[11px] font-semibold text-olive-900">
                  {candidateInitials}
                </span>
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white">
                  <Sparks aria-hidden={true} className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="font-title text-[12.5px] font-semibold text-ink-950">
                    {turn.speakerLabel}
                  </span>
                  <span
                    className={`font-mono text-[11px] tabular-nums ${active ? "text-ink-950" : "text-ink-400"}`}
                  >
                    {formatReplayTime(turn.offsetMs)}
                  </span>
                </span>
                <span className="block text-[13.5px] leading-[1.62] text-[#3c392f]">
                  {turn.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// Walks backwards so the common case (playhead near the end) exits immediately
// and nothing is allocated — this runs on every playhead tick.
function activeTurnIdAt(turns: TranscriptDrawerTurn[], elapsedMs: number) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]!.offsetMs <= elapsedMs) {
      return turns[index]!.turnId;
    }
  }

  return turns[0]?.turnId ?? null;
}
