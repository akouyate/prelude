import { describe, expect, it } from "vitest";

import {
  hasClosingTranscript,
  shouldKeepCurrentRuntimeStatus,
  statusFromSessionState,
  statusFromTranscriptTurn,
  transcriptTurnsFromSessionState,
} from "./live-interview-runtime";
import type { LiveSessionState } from "./live-interview-types";

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
