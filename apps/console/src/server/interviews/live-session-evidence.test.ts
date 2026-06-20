import { describe, expect, it } from "vitest";

import {
  buildCandidateSessionEvidence,
  payloadHasTranscriptTurn,
  transcriptTurnFromPayload,
  type StoredLiveEvent,
} from "./live-session-evidence";

describe("live session evidence", () => {
  it("reconstructs a completed Q/A sequence from persisted runtime events", () => {
    const evidence = buildCandidateSessionEvidence({
      events: [
        event({
          payload: {
            question_id: "q1",
            question_index: 0,
            prompt: "Can you introduce yourself briefly?",
            transcript_turn: transcriptTurn({
              speaker: "interviewer",
              text: "Can you introduce yourself briefly?",
              turn_id: "turn_q1",
            }),
          },
          sequenceNumber: 1,
          type: "question_asked",
        }),
        event({
          actor: "candidate",
          payload: {
            completion_reason: "answered",
            question_id: "q1",
            transcript_turn: transcriptTurn({
              speaker: "candidate",
              text: "I have five years in customer success and onboarding.",
              turn_id: "turn_a1",
            }),
          },
          sequenceNumber: 2,
          type: "candidate_turn_finalized",
        }),
        event({
          payload: {
            completion_reason: "answered",
            question_id: "q1",
          },
          sequenceNumber: 3,
          type: "question_completed",
        }),
        event({
          payload: {
            completed_questions: 1,
            completed_reason: "all_questions_completed",
            total_questions: 1,
          },
          sequenceNumber: 4,
          type: "session_completed",
        }),
      ],
      productSession: productSession(),
      questionCount: 1,
      runtimeSession: runtimeSession({ status: "in_progress" }),
    });

    expect(evidence.status).toBe("completed");
    expect(evidence.terminalEventType).toBe("session_completed");
    expect(evidence.questionCompletionRate).toBe(100);
    expect(evidence.transcriptTurns).toHaveLength(2);
    expect(evidence.questionAnswerSequence).toEqual([
      {
        candidateTurns: [
          expect.objectContaining({
            speaker: "candidate",
            text: "I have five years in customer success and onboarding.",
          }),
        ],
        interviewerTurns: [
          expect.objectContaining({
            speaker: "interviewer",
            text: "Can you introduce yourself briefly?",
          }),
        ],
        questionId: "q1",
      },
    ]);
  });

  it("marks runtime failure from persisted terminal events", () => {
    const evidence = buildCandidateSessionEvidence({
      events: [
        event({
          payload: {
            code: "agent_timeout",
            message: "Agent did not join",
            retryable: true,
          },
          sequenceNumber: 1,
          type: "session_failed",
        }),
      ],
      productSession: productSession({ status: "started" }),
      questionCount: 3,
      runtimeSession: runtimeSession({ status: "in_progress" }),
    });

    expect(evidence.status).toBe("failed");
    expect(evidence.failedAt).toBe("2026-06-20T10:01:00.000Z");
    expect(evidence.questionCompletionRate).toBe(0);
  });

  it("keeps partial sessions reviewable before completion", () => {
    const evidence = buildCandidateSessionEvidence({
      events: [
        event({
          payload: {
            question_id: "q1",
            question_index: 0,
            prompt: "What is your availability?",
            transcript_turn: transcriptTurn({
              speaker: "interviewer",
              text: "What is your availability?",
              turn_id: "turn_q1",
            }),
          },
          sequenceNumber: 1,
          type: "question_asked",
        }),
      ],
      productSession: productSession({ status: "started" }),
      questionCount: 2,
      runtimeSession: runtimeSession({ status: "in_progress" }),
    });

    expect(evidence.status).toBe("in_progress");
    expect(evidence.eventCount).toBe(1);
    expect(evidence.completedAt).toBeNull();
    expect(evidence.transcriptTurns).toHaveLength(1);
  });

  it("detects transcript turns in snake_case and camelCase payloads", () => {
    const snakeCasePayload = {
      transcript_turn: transcriptTurn({
        speaker: "candidate",
        text: "Snake case works.",
        turn_id: "turn_snake",
      }),
    };
    const camelCasePayload = {
      transcriptTurn: {
        endedAt: null,
        isFinal: true,
        questionId: "q1",
        speaker: "candidate",
        startedAt: "2026-06-20T10:00:00.000Z",
        text: "Camel case works.",
        turnId: "turn_camel",
      },
    };

    expect(payloadHasTranscriptTurn(snakeCasePayload)).toBe(true);
    expect(payloadHasTranscriptTurn(camelCasePayload)).toBe(true);
    expect(transcriptTurnFromPayload(camelCasePayload)).toMatchObject({
      speaker: "candidate",
      text: "Camel case works.",
      turnId: "turn_camel",
    });
  });
});

function event({
  actor = "agent",
  payload,
  sequenceNumber,
  type,
}: {
  actor?: string;
  payload: Record<string, unknown>;
  sequenceNumber: number;
  type: string;
}): StoredLiveEvent {
  return {
    actor,
    candidateId: "cs_123",
    id: `evt_${sequenceNumber}`,
    idempotencyKey: `event:${sequenceNumber}:idempotency`,
    occurredAt: new Date(
      `2026-06-20T10:${String(sequenceNumber).padStart(2, "0")}:00.000Z`,
    ),
    payload: payload as StoredLiveEvent["payload"],
    providerMetadata: {},
    sequenceNumber,
    sessionId: "is_123",
    type,
  };
}

function transcriptTurn({
  speaker,
  text,
  turn_id,
}: {
  speaker: "candidate" | "interviewer" | "system";
  text: string;
  turn_id: string;
}) {
  return {
    ended_at: "2026-06-20T10:00:10.000Z",
    is_final: true,
    question_id: "q1",
    session_id: "is_123",
    speaker,
    started_at: "2026-06-20T10:00:00.000Z",
    text,
    turn_id,
  };
}

function productSession(
  overrides: Partial<
    Parameters<typeof buildCandidateSessionEvidence>[0]["productSession"]
  > = {},
) {
  return {
    completedAt: null,
    realtimeSessionId: "is_123",
    status: "started",
    updatedAt: new Date("2026-06-20T10:00:00.000Z"),
    ...overrides,
  };
}

function runtimeSession(overrides: { status?: string } = {}) {
  return {
    id: "is_123",
    status: overrides.status ?? "waiting_candidate",
    updatedAt: new Date("2026-06-20T10:05:00.000Z"),
  };
}
