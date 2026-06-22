import { describe, expect, it } from "vitest";

import {
  liveInterviewEventSchema,
  liveInterviewPlanSchema,
  liveInterviewRecruiterSummaryWireSchema,
  liveInterviewSessionSchema,
  liveInterviewWireEventSchema,
  liveInterviewWorkerAgentConfigSchema,
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
          prompt:
            "Pouvez-vous presenter votre experience client la plus proche ?",
          category: "experience",
          expectedSignal: "Experience concrete en relation client",
          maxFollowups: 1,
        },
      ],
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
          maxFollowups: 2,
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("liveInterviewRecruiterSummaryWireSchema", () => {
  it("normalizes a recruiter summary emitted by the realtime API", () => {
    const result = liveInterviewRecruiterSummaryWireSchema.safeParse({
      summary_id: "rs_session_01",
      session_id: "session_01",
      candidate_id: "candidate_01",
      plan_id: "plan_01",
      role_title: "Product Manager B2B SaaS",
      status: "complete",
      generated_at: "2026-06-17T10:40:00.000Z",
      summary_version: "recruiter-summary-v1",
      generator: "deterministic_v1",
      disclaimer:
        "This summary supports recruiter review and is not an automated hiring decision.",
      overview:
        "The candidate answered 2 of 3 planned first-screen questions with usable evidence.",
      recommendation: {
        value: "needs_recruiter_review",
        label: "Needs recruiter review",
        rationale:
          "The interview contains usable signals, but the recruiter should validate role fit.",
      },
      criteria: [
        {
          criterion_id: "q1",
          label: "Motivation",
          category: "motivation",
          status: "satisfied",
          note: "The candidate gave a concrete motivation answer.",
          evidence: [
            {
              event_id: "evt_turn_1",
              turn_id: "turn_1",
              question_id: "q1",
              speaker: "candidate",
              quote: "Je veux rejoindre une equipe produit proche des clients.",
            },
          ],
        },
      ],
      strengths: [
        {
          title: "Customer-facing product motivation",
          explanation:
            "The candidate connected motivation to customer-facing product work.",
          confidence: "medium",
          evidence: [
            {
              event_id: "evt_turn_1",
              turn_id: "turn_1",
              question_id: "q1",
              speaker: "candidate",
              quote: "Je veux rejoindre une equipe produit proche des clients.",
            },
          ],
        },
      ],
      risks: [],
      question_notes: [
        {
          question_id: "q1",
          prompt: "Bonjour, pouvez-vous vous presenter brievement ?",
          category: "motivation",
          answer_status: "satisfied",
          answer_summary:
            "The candidate gave a usable answer with role-related context.",
          evidence: [
            {
              event_id: "evt_turn_1",
              turn_id: "turn_1",
              question_id: "q1",
              speaker: "candidate",
              quote: "Je veux rejoindre une equipe produit proche des clients.",
            },
          ],
        },
      ],
      follow_up_questions: [
        "Can you validate the concrete product scope mentioned by the candidate?",
      ],
      logistics_notes: ["No logistics constraint captured."],
      missing_information: ["Availability needs recruiter validation."],
      excluded_sensitive_signals: [],
      compliance_flags: ["human_review_required", "protected_traits_excluded"],
      audit: {
        source_event_ids: ["evt_turn_1"],
        transcript_turn_ids: ["turn_1"],
        template_version: "recruiter-summary-v1",
        generated_from_completed_session: true,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.summaryId).toBe("rs_session_01");
    expect(result.data.criteria[0]?.criterionId).toBe("q1");
    expect(result.data.questionNotes[0]?.answerStatus).toBe("satisfied");
    expect(result.data.complianceFlags).toContain("human_review_required");
    expect(result.data.audit.sourceEventIds).toEqual(["evt_turn_1"]);
  });
});

describe("liveInterviewEventSchema", () => {
  it("accepts a normalized question_asked event", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "question_asked",
      actor: "agent",
      sequenceNumber: 3,
      idempotencyKey: "session_01:question_asked:q_01:1",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?",
        transcriptTurn: {
          turnId: "turn_interviewer_01",
          sessionId: "session_01",
          questionId: "q_01",
          speaker: "interviewer",
          text: "Pouvez-vous presenter votre parcours en quelques phrases ?",
          isFinal: true,
          startedAt: "2026-06-17T10:30:00.000Z",
          endedAt: "2026-06-17T10:30:02.000Z",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("normalizes a snake_case wire event from the realtime API", () => {
    const result = liveInterviewWireEventSchema.safeParse({
      event_id: "evt_01",
      session_id: "session_01",
      candidate_id: "candidate_01",
      type: "question_asked",
      actor: "agent",
      sequence_number: 3,
      idempotency_key: "session_01:question_asked:q_01:1",
      occurred_at: "2026-06-17T10:30:00.000Z",
      payload: {
        question_id: "q_01",
        question_index: 0,
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?",
        transcript_turn: {
          turn_id: "turn_interviewer_01",
          session_id: "session_01",
          question_id: "q_01",
          speaker: "interviewer",
          text: "Pouvez-vous presenter votre parcours en quelques phrases ?",
          is_final: true,
          started_at: "2026-06-17T10:30:00.000Z",
          ended_at: "2026-06-17T10:30:02.000Z",
        },
      },
      provider_metadata: {
        provider_event_id: "raw_provider_evt_01",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.eventId).toBe("evt_01");
    expect(result.data.sequenceNumber).toBe(3);
    expect(result.data.type).toBe("question_asked");
    if (result.data.type !== "question_asked") {
      return;
    }
    expect(result.data.payload.transcriptTurn?.speaker).toBe("interviewer");
    expect(result.data.providerMetadata.provider_event_id).toBe(
      "raw_provider_evt_01",
    );
  });

  it("normalizes candidate media readiness from the realtime API", () => {
    const result = liveInterviewWireEventSchema.safeParse({
      event_id: "evt_media_ready",
      session_id: "session_01",
      candidate_id: "candidate_01",
      type: "candidate_media_ready",
      actor: "candidate",
      sequence_number: 2,
      idempotency_key: "session_01:candidate_media_ready",
      occurred_at: "2026-06-17T10:30:00.000Z",
      payload: {
        candidate_participant_id: "candidate-session_01",
        room_name: "prelude-session_01",
        audio: true,
        video: false,
        published_tracks: ["microphone"],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.type).toBe("candidate_media_ready");
    if (result.data.type !== "candidate_media_ready") {
      return;
    }
    expect(result.data.payload.candidateParticipantId).toBe(
      "candidate-session_01",
    );
    expect(result.data.payload.publishedTracks).toEqual(["microphone"]);
  });

  it("accepts a normalized answer_evaluated event", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_answer_eval",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "answer_evaluated",
      actor: "system",
      sequenceNumber: 6,
      idempotencyKey: "session_01:answer_evaluated:q_01:1",
      occurredAt: "2026-06-17T10:30:08.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        turnIds: ["turn_123"],
        attemptIndex: 1,
        classification: "vague",
        reasonCodes: ["too_generic"],
        policyAction: "ask_followup",
        confidence: 0.78,
        evaluatorVersion: "answer-eval-v1",
      },
    });

    expect(result.success).toBe(true);
  });

  it("normalizes answer_evaluated events with a live evaluation matrix", () => {
    const result = liveInterviewWireEventSchema.safeParse({
      event_id: "evt_answer_eval",
      session_id: "session_01",
      candidate_id: "candidate_01",
      type: "answer_evaluated",
      actor: "system",
      sequence_number: 6,
      idempotency_key: "session_01:answer_evaluated:q_01:1",
      occurred_at: "2026-06-17T10:30:08.000Z",
      payload: {
        question_id: "q_01",
        question_index: 0,
        turn_ids: ["turn_123"],
        attempt_index: 1,
        classification: "vague",
        reason_codes: ["incoherent_or_absurd_answer"],
        policy_action: "ask_followup",
        confidence: 0.35,
        evaluator_version: "answer-eval-matrix-v1",
        evaluation_matrix: {
          evaluator_mode: "heuristic_v1",
          overall_score: 3,
          max_score: 15,
          dimensions: [
            {
              name: "coherence",
              score: 0,
              rationale: "No usable coherence signal.",
            },
            {
              name: "relevance",
              score: 0,
              rationale: "No usable relevance signal.",
            },
          ],
          challenge: {
            needed: true,
            reason: "incoherent_or_absurd_answer",
            prompt: "Pouvez-vous repondre avec un exemple concret ?",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.type).toBe("answer_evaluated");
    if (result.data.type !== "answer_evaluated") {
      return;
    }
    expect(result.data.payload.evaluationMatrix?.challenge.needed).toBe(true);
  });

  it("rejects mismatched discriminated event payloads", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_01",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "session_failed",
      actor: "agent",
      sequenceNumber: 7,
      idempotencyKey: "session_01:failed:provider_timeout",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        questionIndex: 0,
        prompt: "This payload belongs to question_asked.",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts state-machine control events", () => {
    const repeated = liveInterviewEventSchema.safeParse({
      eventId: "evt_repeat",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "question_repeated",
      actor: "agent",
      sequenceNumber: 4,
      idempotencyKey: "session_01:repeat:q_01",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: {
        questionId: "q_01",
        prompt: "Pouvez-vous presenter votre parcours en quelques phrases ?",
        reason: "candidate_requested_repeat",
      },
    });
    const reprompted = liveInterviewEventSchema.safeParse({
      eventId: "evt_reprompt",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "soft_reprompted",
      actor: "agent",
      sequenceNumber: 6,
      idempotencyKey: "session_01:reprompt:q_01",
      occurredAt: "2026-06-17T10:30:10.000Z",
      payload: {
        questionId: "q_01",
        prompt: "Pouvez-vous preciser en une ou deux phrases ?",
        repromptsUsed: 1,
      },
    });
    const closing = liveInterviewEventSchema.safeParse({
      eventId: "evt_closing",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "session_closing",
      actor: "agent",
      sequenceNumber: 12,
      idempotencyKey: "session_01:closing",
      occurredAt: "2026-06-17T10:34:00.000Z",
      payload: {
        completedQuestions: 3,
        totalQuestions: 3,
        closing: "Merci, l'entretien est termine.",
      },
    });

    expect(repeated.success).toBe(true);
    expect(reprompted.success).toBe(true);
    expect(closing.success).toBe(true);
  });

  it("accepts turn-taking guardrail events", () => {
    const eventBase = {
      sessionId: "session_01",
      candidateId: "candidate_01",
      actor: "system",
      idempotencyKey: "session_01:turn-taking",
      occurredAt: "2026-06-17T10:30:00.000Z",
    };
    const events = [
      {
        ...eventBase,
        eventId: "evt_agent_speech_started",
        type: "agent_speech_started",
        actor: "agent",
        sequenceNumber: 1,
        payload: {
          questionId: "q_01",
          utteranceId: "q_01:question:0",
          utteranceKind: "question",
        },
      },
      {
        ...eventBase,
        eventId: "evt_agent_speech_completed",
        type: "agent_speech_completed",
        actor: "agent",
        sequenceNumber: 2,
        payload: {
          questionId: "q_01",
          utteranceId: "q_01:question:0",
          utteranceKind: "question",
          audioDurationMs: 2400,
        },
      },
      {
        ...eventBase,
        eventId: "evt_candidate_speech_started",
        type: "candidate_speech_started",
        actor: "candidate",
        sequenceNumber: 3,
        payload: { questionId: "q_01", confidence: 0.94 },
      },
      {
        ...eventBase,
        eventId: "evt_candidate_turn_detected",
        type: "candidate_turn_detected",
        sequenceNumber: 4,
        payload: {
          questionId: "q_01",
          semanticComplete: true,
          stableSilenceMs: 320,
        },
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_detected",
        type: "barge_in_detected",
        actor: "candidate",
        sequenceNumber: 5,
        payload: {
          utteranceId: "q_01:question:0",
          overlapMs: 340,
          candidateSpeechMs: 340,
        },
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_accepted",
        type: "barge_in_accepted",
        sequenceNumber: 6,
        payload: {
          utteranceId: "q_01:question:0",
          cancelLatencyMs: 120,
          truncatedAtMs: 340,
        },
      },
      {
        ...eventBase,
        eventId: "evt_agent_speech_interrupted",
        type: "agent_speech_interrupted",
        sequenceNumber: 7,
        payload: {
          utteranceId: "q_01:question:0",
          cancelLatencyMs: 120,
          cancelAgentAudio: true,
        },
      },
      {
        ...eventBase,
        eventId: "evt_barge_in_rejected",
        type: "barge_in_rejected",
        sequenceNumber: 8,
        payload: {
          reason: "backchannel",
          observedSpeechMs: 180,
        },
      },
      {
        ...eventBase,
        eventId: "evt_backchannel_detected",
        type: "backchannel_detected",
        sequenceNumber: 9,
        payload: {
          reason: "backchannel",
          observedSpeechMs: 180,
        },
      },
      {
        ...eventBase,
        eventId: "evt_silence_timeout",
        type: "silence_timeout_started",
        sequenceNumber: 10,
        payload: {
          questionId: "q_01",
          thresholdMs: 10000,
          silentForMs: 12000,
          tier: "soft_prompt",
        },
      },
      {
        ...eventBase,
        eventId: "evt_wait_requested",
        type: "wait_requested",
        actor: "candidate",
        sequenceNumber: 11,
        payload: {
          questionId: "q_01",
          reason: "candidate_requested_time",
        },
      },
      {
        ...eventBase,
        eventId: "evt_candidate_speech_stopped",
        type: "candidate_speech_stopped",
        actor: "candidate",
        sequenceNumber: 12,
        payload: { questionId: "q_01", speechDurationMs: 2100 },
      },
    ];

    expect(
      events.every(
        (event) => liveInterviewEventSchema.safeParse(event).success,
      ),
    ).toBe(true);
  });

  it("rejects sequence zero to match the Go event contract", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_zero",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "candidate_speech_started",
      actor: "candidate",
      sequenceNumber: 0,
      idempotencyKey: "session_01:zero",
      occurredAt: "2026-06-17T10:30:00.000Z",
      payload: { questionId: "q_01" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts terminal completion counters for metrics", () => {
    const result = liveInterviewEventSchema.safeParse({
      eventId: "evt_completed",
      sessionId: "session_01",
      candidateId: "candidate_01",
      type: "session_completed",
      actor: "agent",
      sequenceNumber: 14,
      idempotencyKey: "session_01:completed",
      occurredAt: "2026-06-17T10:35:00.000Z",
      payload: {
        completedReason: "all_questions_completed",
        completedQuestions: 3,
        totalQuestions: 3,
      },
    });

    expect(result.success).toBe(true);
  });
});

describe("liveInterviewWorkerAgentConfigSchema", () => {
  const validWorkerConfig = (category: string) => ({
    session: {
      id: "session_01",
      interview_plan_id: "plan_01",
      candidate_id: "candidate_01",
      status: "waiting_candidate",
      livekit_room_name: "prelude-session-01",
      allowed_modalities: ["audio", "video"],
      created_at: "2026-06-17T10:00:00.000Z",
      updated_at: "2026-06-17T10:00:00.000Z",
    },
    livekit_join: {
      room_name: "prelude-session-01",
      url: "wss://mock-livekit.prelude.local",
      token: "mock_lk_session_01_agent-session_01",
      participant: "agent-session_01",
      expires_at: "2026-06-17T10:15:00.000Z",
    },
    interview_plan: {
      id: "plan_01",
      role_title: "Product Manager",
      language: "fr",
      questions: [
        {
          id: "q1",
          prompt: "Pouvez-vous vous presenter brievement ?",
          category,
        },
      ],
      allow_video: true,
      allow_audio_only: true,
      max_followups_per_question: 1,
    },
    provider: "mock",
  });

  it("accepts the Go realtime API worker config response", () => {
    expect(
      liveInterviewWorkerAgentConfigSchema.safeParse(
        validWorkerConfig("motivation"),
      ).success,
    ).toBe(true);
  });

  it("accepts role_fit (the Go clamp target for non-shared categories)", () => {
    expect(
      liveInterviewWorkerAgentConfigSchema.safeParse(
        validWorkerConfig("role_fit"),
      ).success,
    ).toBe(true);
  });

  it("rejects a category outside the strict worker enum (would crash the Python worker)", () => {
    expect(
      liveInterviewWorkerAgentConfigSchema.safeParse(
        validWorkerConfig("skills"),
      ).success,
    ).toBe(false);
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
      updatedAt: "2026-06-17T10:01:00.000Z",
    });

    expect(result.success).toBe(true);
  });
});
