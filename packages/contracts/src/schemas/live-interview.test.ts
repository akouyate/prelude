import { describe, expect, it } from "vitest";

import {
  liveInterviewEventSchema,
  liveInterviewPlanSchema,
  liveInterviewSessionSchema,
  liveInterviewWorkerAgentConfigSchema
} from "./live-interview";

describe("liveInterviewPlanSchema", () => {
  it("accepts a short structured live interview plan", () => {
    const result = liveInterviewPlanSchema.safeParse({
      planId: "plan_01",
      jobId: "job_01",
      roleTitle: "Customer Success Manager",
      locale: "fr-FR",
      candidateModes: ["audio", "video"],
      questions: [
        {
          id: "q_01",
          prompt: "Pouvez-vous presenter votre experience client la plus proche ?",
          category: "experience",
          expectedSignal: "Experience concrete en relation client",
          maxFollowups: 1
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("rejects plans with more than one follow-up per question", () => {
    const result = liveInterviewPlanSchema.safeParse({
      planId: "plan_01",
      jobId: "job_01",
      roleTitle: "Account Executive",
      candidateModes: ["audio"],
      questions: [
        {
          id: "q_01",
          prompt: "Pourquoi ce poste vous interesse aujourd'hui ?",
          maxFollowups: 2
        }
      ]
    });

    expect(result.success).toBe(false);
  });
});

describe("liveInterviewEventSchema", () => {
  it("accepts a normalized question_asked event", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      type: "question_asked",
      actor: "agent",
      sequence: 3,
      idempotencyKey: "session_01:question_asked:q_01:1",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?"
      }
    });

    expect(result.success).toBe(true);
  });

  it("rejects mismatched discriminated event payloads", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      type: "session_failed",
      actor: "agent",
      sequence: 7,
      idempotencyKey: "session_01:failed:provider_timeout",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "This payload belongs to question_asked."
      }
    });

    expect(result.success).toBe(false);
  });

  it("accepts state-machine control events", () => {
    const repeated = liveInterviewEventSchema.safeParse({
      eventId: "evt_repeat",
      sessionId: "session_01",
      type: "question_repeated",
      actor: "agent",
      sequence: 4,
      idempotencyKey: "session_01:repeat:q_01",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?",
        reason: "candidate_requested_repeat"
      }
    });
    const reprompted = liveInterviewEventSchema.safeParse({
      eventId: "evt_reprompt",
      sessionId: "session_01",
      type: "soft_reprompted",
      actor: "agent",
      sequence: 6,
      idempotencyKey: "session_01:reprompt:q_01",
      occurredAt: "2026-06-17T10:30:10.000Z",
      payload: {
        questionId: "q_01",
        prompt: "Pouvez-vous preciser en une ou deux phrases ?",
        repromptsUsed: 1
      }
    });
    const closing = liveInterviewEventSchema.safeParse({
      eventId: "evt_closing",
      sessionId: "session_01",
      type: "session_closing",
      actor: "agent",
      sequence: 12,
      idempotencyKey: "session_01:closing",
      occurredAt: "2026-06-17T10:34:00.000Z",
      payload: {
        completedQuestions: 3,
        closing: "Merci, l'entretien est termine."
      }
    });

    expect(repeated.success).toBe(true);
    expect(reprompted.success).toBe(true);
    expect(closing.success).toBe(true);
  });

  it("accepts turn-taking guardrail events", () => {
    const eventBase = {
      sessionId: "session_01",
      actor: "system",
      idempotencyKey: "session_01:turn-taking",
      occurredAt: "2026-06-17T10:30:00.000Z"
    };
    const events = [
      {
        ...eventBase,
        eventId: "evt_agent_speech_started",
        type: "agent_speech_started",
        actor: "agent",
        sequence: 1,
        payload: {
          questionId: "q_01",
          utteranceId: "q_01:question:0",
          utteranceKind: "question"
        }
      },
      {
        ...eventBase,
        eventId: "evt_agent_speech_completed",
        type: "agent_speech_completed",
        actor: "agent",
        sequence: 2,
        payload: {
          questionId: "q_01",
          utteranceId: "q_01:question:0",
          utteranceKind: "question",
          audioDurationMs: 2400
        }
      },
      {
        ...eventBase,
        eventId: "evt_candidate_speech_started",
        type: "candidate_speech_started",
        actor: "candidate",
        sequence: 3,
        payload: { questionId: "q_01", confidence: 0.94 }
      },
      {
        ...eventBase,
        eventId: "evt_candidate_turn_detected",
        type: "candidate_turn_detected",
        sequence: 4,
        payload: {
          questionId: "q_01",
          semanticComplete: true,
          stableSilenceMs: 320
        }
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_detected",
        type: "barge_in_detected",
        actor: "candidate",
        sequence: 5,
        payload: {
          utteranceId: "q_01:question:0",
          overlapMs: 340,
          candidateSpeechMs: 340
        }
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_accepted",
        type: "barge_in_accepted",
        sequence: 6,
        payload: {
          utteranceId: "q_01:question:0",
          cancelLatencyMs: 120,
          truncatedAtMs: 340
        }
      },
      {
        ...eventBase,
        eventId: "evt_agent_speech_interrupted",
        type: "agent_speech_interrupted",
        sequence: 7,
        payload: {
          utteranceId: "q_01:question:0",
          cancelLatencyMs: 120,
          cancelAgentAudio: true
        }
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_rejected",
        type: "barge_in_rejected",
        sequence: 8,
        payload: {
          reason: "backchannel",
          observedSpeechMs: 180
        }
      },
      {
        ...eventBase,
        eventId: "evt_backchannel_detected",
        type: "backchannel_detected",
        sequence: 9,
        payload: {
          reason: "backchannel",
          observedSpeechMs: 180
        }
      },
      {
        ...eventBase,
        eventId: "evt_silence_timeout",
        type: "silence_timeout_started",
        sequence: 10,
        payload: {
          questionId: "q_01",
          thresholdMs: 10000,
          silentForMs: 12000,
          tier: "soft_prompt"
        }
      },
      {
        ...eventBase,
        eventId: "evt_wait_requested",
        type: "wait_requested",
        actor: "candidate",
        sequence: 11,
        payload: {
          questionId: "q_01",
          reason: "candidate_requested_time"
        }
      },
      {
        ...eventBase,
        eventId: "evt_candidate_speech_stopped",
        type: "candidate_speech_stopped",
        actor: "candidate",
        sequence: 12,
        payload: { questionId: "q_01", speechDurationMs: 2100 }
      }
    ];

    expect(events.every((event) => liveInterviewEventSchema.safeParse(event).success)).toBe(true);
  });

  it("rejects sequence zero to match the Go event contract", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_zero",
      sessionId: "session_01",
      type: "candidate_speech_started",
      actor: "candidate",
      sequence: 0,
      idempotencyKey: "session_01:zero",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: { questionId: "q_01" }
    });

    expect(result.success).toBe(false);
  });
});

describe("liveInterviewWorkerAgentConfigSchema", () => {
  it("accepts the Go realtime API worker config response", () => {
    const result = liveInterviewWorkerAgentConfigSchema.safeParse({
      session: {
        id: "session_01",
        interview_plan_id: "plan_01",
        candidate_id: "candidate_01",
        status: "waiting_candidate",
        livekit_room_name: "prelude-session-01",
        allowed_modalities: ["audio", "video"],
        created_at: "2026-06-17T10:00:00.000Z",
        updated_at: "2026-06-17T10:00:00.000Z"
      },
      livekit_join: {
        room_name: "prelude-session-01",
        url: "wss://mock-livekit.prelude.local",
        token: "mock_lk_session_01_agent-session_01",
        participant: "agent-session_01",
        expires_at: "2026-06-17T10:15:00.000Z"
      },
      interview_plan: {
        id: "plan_01",
        role_title: "Product Manager",
        language: "fr",
        questions: [
          {
            id: "q1",
            prompt: "Pouvez-vous vous presenter brievement ?",
            category: "motivation"
          }
        ],
        allow_video: true,
        allow_audio_only: true,
        max_followups_per_question: 1
      },
      provider: "mock"
    });

    expect(result.success).toBe(true);
  });
});

describe("liveInterviewSessionSchema", () => {
  it("accepts an agent_joining session state", () => {
    const result = liveInterviewSessionSchema.safeParse({
      sessionId: "session_01",
      candidateId: "candidate_01",
      planId: "plan_01",
      status: "agent_joining",
      livekitRoomName: "prelude-session-01",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: "2026-06-17T10:01:00.000Z"
    });

    expect(result.success).toBe(true);
  });
});
