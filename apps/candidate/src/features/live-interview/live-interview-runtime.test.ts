import { describe, expect, it } from "vitest";

import {
  hasClosingTranscript,
  selectInterviewerView,
  shouldKeepCurrentRuntimeStatus,
  statusFromSessionState,
  statusFromTranscriptTurn,
  transcriptTurnsFromSessionState,
  visibleInterviewerTurns,
} from "./live-interview-runtime";
import type {
  LiveSessionState,
  LiveTranscriptTurn,
} from "./live-interview-types";

describe("live interview runtime state", () => {
  it("maps realtime events to candidate room states", () => {
    expect(statusFromSessionState(state("agent_joining", []))).toBe(
      "interviewer_joining",
    );
    expect(statusFromSessionState(state("in_progress", [event("agent_joined")]))).toBe(
      "agent_joined",
    );
    expect(
      statusFromSessionState(state("in_progress", [event("agent_speech_started")])),
    ).toBe("interviewer_speaking");
    expect(
      statusFromSessionState(state("in_progress", [event("candidate_turn_started")])),
    ).toBe("candidate_speaking");
    expect(
      statusFromSessionState(state("in_progress", [event("answer_evaluated")])),
    ).toBe("listening");
    expect(
      statusFromSessionState(state("completed", [event("session_closing")])),
    ).toBe("completed");
  });

  it("keeps reconnecting and closing stable until terminal states arrive", () => {
    expect(shouldKeepCurrentRuntimeStatus("reconnecting", "listening")).toBe(
      true,
    );
    expect(shouldKeepCurrentRuntimeStatus("closing", "listening")).toBe(true);
    expect(shouldKeepCurrentRuntimeStatus("closing", "failed")).toBe(false);
  });

  it("derives speaking state from realtime transcript packets", () => {
    expect(
      statusFromTranscriptTurn(
        {
          isFinal: true,
          sessionId: "is_1",
          speaker: "interviewer",
          startedAt: "2026-06-21T09:00:00Z",
          text: "Hello.",
          turnId: "turn_1",
        },
        "connected",
      ),
    ).toBe("interviewer_speaking");
  });

  it("extracts closing transcript turns from realtime events", () => {
    const snapshot = state("completed", [
      event("session_closing", {
        transcript_turn: {
          is_final: true,
          session_id: "is_1",
          speaker: "interviewer",
          started_at: "2026-06-21T09:00:00Z",
          text: "Merci, votre entretien est termine.",
          turn_id: "closing",
        },
      }),
      event("session_completed"),
    ]);

    expect(hasClosingTranscript(snapshot)).toBe(true);
    expect(transcriptTurnsFromSessionState(snapshot)).toEqual([
      {
        isFinal: true,
        sessionId: "is_1",
        speaker: "interviewer",
        startedAt: "2026-06-21T09:00:00Z",
        text: "Merci, votre entretien est termine.",
        turnId: "closing",
      },
    ]);
  });
});

function state(
  status: string,
  events: LiveSessionState["events"],
): LiveSessionState {
  return {
    events: events.map((item, index) => ({
      ...item,
      sequence: item.sequence || index + 1,
    })),
    sessionId: "is_1",
    status,
  };
}

function event(type: string, payload: Record<string, unknown> = {}) {
  return {
    actor: "agent",
    eventId: `evt_${type}`,
    occurredAt: "2026-06-21T09:00:00Z",
    payload,
    sequence: 1,
    type,
  };
}

describe("visibleInterviewerTurns", () => {
  const turn = (overrides: Partial<LiveTranscriptTurn>): LiveTranscriptTurn => ({
    isFinal: true,
    sessionId: "is_1",
    speaker: "interviewer",
    startedAt: "2026-06-23T10:00:00Z",
    text: "question",
    turnId: "t",
    ...overrides,
  });

  it("shows only finalized interviewer turns — never the candidate, never partials", () => {
    const turns = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "First question.", turnId: "i1" }),
      turn({ speaker: "candidate", startedAt: "2026-06-23T10:00:30Z", text: "My answer.", turnId: "c1" }),
      turn({ isFinal: false, startedAt: "2026-06-23T10:01:00Z", text: "And how", turnId: "i2_partial" }),
      turn({ startedAt: "2026-06-23T10:01:02Z", text: "Second question.", turnId: "i2" }),
      turn({ speaker: "system", startedAt: "2026-06-23T10:01:05Z", text: "noise", turnId: "sys" }),
    ];

    expect(visibleInterviewerTurns(turns).map((item) => item.turnId)).toEqual([
      "i1",
      "i2",
    ]);
  });

  it("sorts by start time with a stable turnId tiebreak (no reorder flicker)", () => {
    const turns = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "B question.", turnId: "b" }),
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "A question.", turnId: "a" }),
    ];

    expect(visibleInterviewerTurns(turns).map((item) => item.turnId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("collapses exact-duplicate finalized questions (same text, different ids)", () => {
    // The realtime stream sometimes finalizes the same phrase twice with
    // different turn ids — that showed as duplicated lines in the live UI.
    const turns = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "Tell us about a project.", turnId: "a" }),
      turn({ startedAt: "2026-06-23T10:00:01Z", text: "Tell us about a project.", turnId: "b" }),
    ];

    expect(visibleInterviewerTurns(turns).map((item) => item.turnId)).toEqual(["a"]);
  });

  it("collapses a leaked streaming partial into its finalized phrase", () => {
    // The same utterance leaks in at several lengths (a streaming partial that
    // defaulted to final, plus the full turn). The truncated fragment must fold
    // into the complete one instead of showing as its own dimmed line.
    const turns = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "Bonjour, qu'est-ce qui vous a", turnId: "partial" }),
      turn({ startedAt: "2026-06-23T10:00:01Z", text: "Bonjour, qu'est-ce qui vous a donné envie ?", turnId: "full" }),
    ];

    expect(visibleInterviewerTurns(turns).map((item) => item.turnId)).toEqual(["full"]);
  });

  it("keeps two complete questions even when one is a prefix of the other", () => {
    // A finished question ends with terminal punctuation, so a genuine pair is
    // never merged — only unterminated fragments fold in.
    const turns = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "Parlez-moi de votre parcours.", turnId: "q1" }),
      turn({ startedAt: "2026-06-23T10:00:01Z", text: "Parlez-moi de votre parcours en gestion de projet.", turnId: "q2" }),
    ];

    expect(visibleInterviewerTurns(turns).map((item) => item.turnId)).toEqual([
      "q1",
      "q2",
    ]);
  });
});

describe("selectInterviewerView", () => {
  const turn = (overrides: Partial<LiveTranscriptTurn>): LiveTranscriptTurn => ({
    isFinal: true,
    sessionId: "is_1",
    speaker: "interviewer",
    startedAt: "2026-06-23T10:00:00Z",
    text: "question",
    turnId: "t",
    ...overrides,
  });

  it("streams the live caption as the active line while the agent is speaking", () => {
    const finals = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "First question.", turnId: "i1" }),
    ];
    const caption = turn({
      isFinal: false,
      startedAt: "2026-06-23T10:01:00Z",
      text: "And how did you",
      turnId: "i2",
    });

    expect(selectInterviewerView({ finalTurns: finals, caption })).toEqual({
      activeText: "And how did you",
      activeTurnId: "i2",
      isStreaming: true,
      previous: [finals[0]],
    });
  });

  it("keeps the caption as a calm active line once the segment is final", () => {
    const caption = turn({ text: "Second question.", turnId: "i2" });
    const view = selectInterviewerView({
      finalTurns: [
        turn({ startedAt: "2026-06-23T10:00:00Z", text: "First question.", turnId: "i1" }),
      ],
      caption,
    });

    expect(view.activeText).toBe("Second question.");
    expect(view.isStreaming).toBe(false);
  });

  it("never shows the caption's own finalized twin in the dimmed history", () => {
    // The same segment also arrives as a finalized turn (LiveKit close, the
    // prelude data packet, or HTTP polling). It must not render twice.
    const caption = turn({ text: "Second question.", turnId: "i2" });
    const finals = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "First question.", turnId: "i1" }),
      turn({ startedAt: "2026-06-23T10:01:02Z", text: "second question.", turnId: "i2-http" }),
    ];

    const view = selectInterviewerView({ finalTurns: finals, caption });

    expect(view.activeText).toBe("Second question.");
    expect(view.previous.map((item) => item.turnId)).toEqual(["i1"]);
  });

  it("falls back to the latest finalized turn when there is no caption", () => {
    const finals = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "First question.", turnId: "i1" }),
      turn({ startedAt: "2026-06-23T10:01:00Z", text: "Second question.", turnId: "i2" }),
    ];

    expect(selectInterviewerView({ finalTurns: finals, caption: null })).toEqual({
      activeText: "Second question.",
      activeTurnId: "i2",
      isStreaming: false,
      previous: [finals[0]],
    });
  });

  it("ignores a blank caption and an empty history", () => {
    expect(
      selectInterviewerView({
        finalTurns: [],
        caption: turn({ isFinal: false, text: "   ", turnId: "blank" }),
      }),
    ).toEqual({
      activeText: null,
      activeTurnId: null,
      isStreaming: false,
      previous: [],
    });
  });

  it("collapses a re-streamed greeting (caption + finalized twins) to one line", () => {
    // The greeting arrives as a finalized full turn AND a leaked truncated
    // partial AND is re-streamed as the live caption. Only the caption shows.
    const finals = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "Bonjour, qu'est-ce qui vous a", turnId: "partial" }),
      turn({ startedAt: "2026-06-23T10:00:01Z", text: "Bonjour, qu'est-ce qui vous a donné envie de rejoindre ?", turnId: "full" }),
    ];
    const caption = turn({
      isFinal: false,
      text: "Bonjour, qu'est-ce qui vous a donné",
      turnId: "live",
    });

    const view = selectInterviewerView({ finalTurns: finals, caption });

    expect(view.activeText).toBe("Bonjour, qu'est-ce qui vous a donné");
    expect(view.previous).toEqual([]);
  });

  it("keeps an older distinct question that merely shares a prefix with the caption", () => {
    const finals = [
      turn({ startedAt: "2026-06-23T10:00:00Z", text: "Parlez-moi de votre parcours.", turnId: "old" }),
      turn({ startedAt: "2026-06-23T10:01:00Z", text: "Pouvez-vous décrire le contexte ?", turnId: "recent" }),
    ];
    const caption = turn({ isFinal: false, text: "Parlez-moi de", turnId: "live" });

    const view = selectInterviewerView({ finalTurns: finals, caption });

    expect(view.previous.map((item) => item.turnId)).toEqual(["old", "recent"]);
  });

  it("keeps at most the three most recent previous questions", () => {
    const finals = [1, 2, 3, 4].map((index) =>
      turn({
        startedAt: `2026-06-23T10:0${index}:00Z`,
        text: `Question ${index}.`,
        turnId: `i${index}`,
      }),
    );
    const caption = turn({ isFinal: false, text: "Live one", turnId: "live" });

    expect(
      selectInterviewerView({ finalTurns: finals, caption }).previous.map(
        (item) => item.turnId,
      ),
    ).toEqual(["i2", "i3", "i4"]);
  });
});
