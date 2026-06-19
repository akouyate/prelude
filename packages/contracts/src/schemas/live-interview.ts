import { z } from "zod";

export const liveInterviewProviderSchema = z.enum([
  "openai_realtime",
  "elevenlabs",
  "mock",
]);

export const liveInterviewModeSchema = z.enum(["audio", "video", "form"]);

export const liveInterviewSessionStatusSchema = z.enum([
  "created",
  "waiting_candidate",
  "agent_joining",
  "in_progress",
  "paused",
  "completed",
  "failed",
  "expired",
]);

export const liveInterviewSpeakerSchema = z.enum([
  "candidate",
  "interviewer",
  "system",
]);

export const liveInterviewEventActorSchema = z.enum([
  "agent",
  "candidate",
  "system",
]);

export const liveInterviewAnswerClassificationSchema = z.enum([
  "complete",
  "vague",
  "incomplete",
  "silent",
  "skipped",
  "repeat_requested",
  "wait_requested",
]);

export const liveInterviewPolicyActionSchema = z.enum([
  "complete_question",
  "ask_followup",
  "soft_reprompt",
  "repeat_question",
  "wait",
  "mark_skipped",
  "timebox",
]);

export const liveInterviewEvaluationDimensionSchema = z.enum([
  "clarity",
  "relevance",
  "concreteness",
  "coherence",
  "role_signal",
]);

export const liveInterviewQuestionCategorySchema = z.enum([
  "motivation",
  "experience",
  "skills",
  "logistics",
  "availability",
  "compensation",
  "custom",
]);

export const liveInterviewQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(8).max(800),
  category: liveInterviewQuestionCategorySchema.default("custom"),
  expectedSignal: z.string().trim().min(4).max(500).optional(),
  required: z.boolean().default(true),
  maxFollowups: z.number().int().min(0).max(1).default(1),
});

export const liveInterviewPlanSchema = z.object({
  planId: z.string().min(1),
  jobId: z.string().min(1),
  roleTitle: z.string().trim().min(2).max(160),
  locale: z.string().min(2).default("fr-FR"),
  candidateModes: z.array(liveInterviewModeSchema).min(1).max(3),
  questions: z.array(liveInterviewQuestionSchema).min(1).max(8),
});

export const liveInterviewSessionSchema = z.object({
  sessionId: z.string().min(1),
  candidateId: z.string().min(1),
  planId: z.string().min(1),
  status: liveInterviewSessionStatusSchema,
  livekitRoomName: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const liveInterviewTranscriptTurnSchema = z.object({
  turnId: z.string().min(1),
  sessionId: z.string().min(1),
  questionId: z.string().min(1).optional(),
  speaker: liveInterviewSpeakerSchema,
  text: z.string().trim().min(1).max(12000),
  isFinal: z.boolean().default(true),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const liveInterviewEventBaseSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  candidateId: z.string().min(1),
  actor: liveInterviewEventActorSchema,
  sequenceNumber: z.number().int().min(1),
  idempotencyKey: z.string().min(8),
  occurredAt: z.string().datetime(),
  providerMetadata: z.record(z.string(), z.unknown()).default({}),
});

const optionalQuestionSignalPayloadSchema = z.object({
  questionId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  trackId: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const agentSpeechPayloadSchema = z.object({
  questionId: z.string().min(1).optional(),
  utteranceId: z.string().min(1),
  utteranceKind: z.enum([
    "intro",
    "question",
    "repeat",
    "soft_reprompt",
    "followup",
    "closing",
  ]),
  audioDurationMs: z.number().int().min(0).optional(),
});

const interruptionPayloadSchema = z.object({
  utteranceId: z.string().min(1),
  questionId: z.string().min(1).optional(),
  overlapMs: z.number().int().min(0).optional(),
  candidateSpeechMs: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const rejectedInterruptionPayloadSchema = z.object({
  utteranceId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  reason: z.enum(["backchannel", "noise", "too_short", "low_confidence"]),
  observedSpeechMs: z.number().int().min(0).optional(),
});

export const liveInterviewEventSchema = z.discriminatedUnion("type", [
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_started"),
    payload: z.object({
      provider: liveInterviewProviderSchema,
      agentParticipantId: z.string().min(1),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_joined"),
    payload: z.object({
      candidateParticipantId: z.string().min(1),
      modes: z.array(liveInterviewModeSchema).min(1).max(3),
      roomName: z.string().min(1).optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_media_ready"),
    payload: z.object({
      candidateParticipantId: z.string().min(1),
      roomName: z.string().min(1).optional(),
      audio: z.boolean(),
      video: z.boolean(),
      publishedTracks: z
        .array(z.enum(["microphone", "camera"]))
        .min(1)
        .max(2),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("agent_joined"),
    payload: z.object({
      agentParticipantId: z.string().min(1),
      provider: liveInterviewProviderSchema,
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("agent_speech_started"),
    payload: agentSpeechPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("agent_speech_completed"),
    payload: agentSpeechPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("agent_speech_interrupted"),
    payload: interruptionPayloadSchema.extend({
      cancelLatencyMs: z.number().int().min(0),
      truncatedAtMs: z.number().int().min(0).optional(),
      cancelAgentAudio: z.literal(true),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("question_asked"),
    payload: z.object({
      questionId: z.string().min(1),
      questionIndex: z.number().int().min(0),
      prompt: z.string().trim().min(8).max(800),
      transcriptTurn: liveInterviewTranscriptTurnSchema.optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("question_repeated"),
    payload: z.object({
      questionId: z.string().min(1),
      prompt: z.string().trim().min(8).max(800),
      reason: z.literal("candidate_requested_repeat"),
      transcriptTurn: liveInterviewTranscriptTurnSchema.optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_speech_started"),
    payload: optionalQuestionSignalPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_speech_stopped"),
    payload: optionalQuestionSignalPayloadSchema.extend({
      speechDurationMs: z.number().int().min(0).optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_turn_detected"),
    payload: z.object({
      questionId: z.string().min(1),
      semanticComplete: z.boolean().optional(),
      stableSilenceMs: z.number().int().min(0).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_turn_started"),
    payload: z.object({
      questionId: z.string().min(1).optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_turn_finalized"),
    payload: z.object({
      questionId: z.string().min(1),
      completionReason: z.enum(["answered", "skipped", "incomplete"]),
      transcriptTurn: liveInterviewTranscriptTurnSchema,
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("answer_evaluated"),
    payload: z.object({
      questionId: z.string().min(1),
      questionIndex: z.number().int().min(0).optional(),
      turnIds: z.array(z.string().min(1)).min(1),
      attemptIndex: z.number().int().min(1),
      classification: liveInterviewAnswerClassificationSchema,
      reasonCodes: z.array(z.string().min(1).max(80)),
      policyAction: liveInterviewPolicyActionSchema,
      confidence: z.number().min(0).max(1),
      evaluatorVersion: z.string().min(1).max(80),
      evaluationMatrix: z
        .object({
          evaluatorMode: z.enum(["heuristic_v1", "llm_assisted"]),
          overallScore: z.number().int().min(0).max(15),
          maxScore: z.number().int().min(1).max(15),
          dimensions: z
            .array(
              z.object({
                name: liveInterviewEvaluationDimensionSchema,
                score: z.number().int().min(0).max(3),
                rationale: z.string().trim().min(4).max(240),
              }),
            )
            .min(1)
            .max(5),
          challenge: z.object({
            needed: z.boolean(),
            reason: z.string().trim().min(2).max(120).nullable().optional(),
            prompt: z.string().trim().min(8).max(500).nullable().optional(),
          }),
        })
        .optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("barge_in_detected"),
    payload: interruptionPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("barge_in_accepted"),
    payload: interruptionPayloadSchema.extend({
      cancelLatencyMs: z.number().int().min(0),
      truncatedAtMs: z.number().int().min(0).optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("barge_in_rejected"),
    payload: rejectedInterruptionPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("backchannel_detected"),
    payload: rejectedInterruptionPayloadSchema,
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("silence_timeout_started"),
    payload: z.object({
      questionId: z.string().min(1).optional(),
      thresholdMs: z.number().int().min(1),
      silentForMs: z.number().int().min(0).optional(),
      tier: z.enum(["soft_prompt", "wait_extension", "terminal"]),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("wait_requested"),
    payload: z.object({
      questionId: z.string().min(1).optional(),
      requestedAt: z.string().datetime().optional(),
      waitUntil: z.string().datetime().optional(),
      reason: z.literal("candidate_requested_time"),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("soft_reprompted"),
    payload: z.object({
      questionId: z.string().min(1),
      prompt: z.string().trim().min(8).max(800),
      repromptsUsed: z.number().int().min(1).max(1),
      transcriptTurn: liveInterviewTranscriptTurnSchema.optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("followup_asked"),
    payload: z.object({
      questionId: z.string().min(1),
      followupId: z.string().min(1),
      prompt: z.string().trim().min(8).max(800),
      followupsUsed: z.number().int().min(1).max(1),
      attemptIndex: z.number().int().min(1).optional(),
      transcriptTurn: liveInterviewTranscriptTurnSchema.optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("question_completed"),
    payload: z.object({
      questionId: z.string().min(1),
      completionReason: z.enum([
        "answered",
        "skipped",
        "candidate_silent",
        "timeboxed",
      ]),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_completed"),
    payload: z.object({
      completedReason: z.enum([
        "all_questions_completed",
        "candidate_ended",
        "timeboxed",
      ]),
      completedQuestions: z.number().int().min(0),
      totalQuestions: z.number().int().min(1),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_closing"),
    payload: z.object({
      completedQuestions: z.number().int().min(0),
      closing: z.string().trim().min(1).max(800),
      totalQuestions: z.number().int().min(1),
      transcriptTurn: liveInterviewTranscriptTurnSchema.optional(),
    }),
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_failed"),
    payload: z.object({
      code: z.string().min(2).max(80),
      message: z.string().min(1).max(500),
      retryable: z.boolean().default(false),
    }),
  }),
]);

type UnknownRecord = Record<string, unknown>;

export const liveInterviewWireEventSchema = z.preprocess((value) => {
  const normalized = normalizeWireKeys(value);
  if (isUnknownRecord(normalized) && normalized.sequenceNumber === undefined) {
    const sequence = normalized.sequence;
    if (sequence !== undefined) {
      return {
        ...normalized,
        sequenceNumber: sequence,
      };
    }
  }
  return normalized;
}, liveInterviewEventSchema);

function normalizeWireKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWireKeys(item));
  }
  if (!isUnknownRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const normalizedKey = wireKeyToCamel(key);
      if (normalizedKey === "providerMetadata") {
        return [normalizedKey, child];
      }
      return [normalizedKey, normalizeWireKeys(child)];
    }),
  );
}

function wireKeyToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const createLiveInterviewSessionInputSchema = z.object({
  candidateToken: z.string().min(8),
  planId: z.string().min(1),
});

export const createLiveInterviewSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: liveInterviewSessionStatusSchema,
  livekitRoomName: z.string().min(1),
  candidateLivekitToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const liveInterviewAgentConfigSchema = z.object({
  session: liveInterviewSessionSchema,
  plan: liveInterviewPlanSchema,
  agentLivekitToken: z.string().min(1),
  provider: liveInterviewProviderSchema,
});

export const liveInterviewWorkerAgentConfigSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    interview_plan_id: z.string().min(1),
    candidate_id: z.string().min(1),
    status: liveInterviewSessionStatusSchema,
    livekit_room_name: z.string().min(1),
    allowed_modalities: z.array(liveInterviewModeSchema).min(1),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  }),
  livekit_join: z.object({
    room_name: z.string().min(1),
    url: z.string().url().or(z.string().startsWith("wss://")),
    token: z.string().min(1),
    participant: z.string().min(1),
    expires_at: z.string().datetime(),
  }),
  interview_plan: z.object({
    id: z.string().min(1),
    role_title: z.string().trim().min(2).max(160),
    language: z.string().min(2).default("fr"),
    questions: z
      .array(
        z.object({
          id: z.string().min(1),
          prompt: z.string().trim().min(8).max(800),
          category: z.string().min(1),
          follow_up_prompt: z.string().trim().min(8).max(800).optional(),
        }),
      )
      .min(1)
      .max(8),
    allow_video: z.boolean().default(true),
    allow_audio_only: z.boolean().default(true),
    max_followups_per_question: z.number().int().min(0).max(2).default(1),
  }),
  provider: liveInterviewProviderSchema,
});

export const liveInterviewRecruiterSummaryRecommendationSchema = z.enum([
  "proceed_to_recruiter_review",
  "needs_recruiter_review",
  "insufficient_evidence",
  "follow_up_required",
  "potential_fit_pending_validation",
]);

export const liveInterviewRecruiterSummaryCriterionStatusSchema = z.enum([
  "satisfied",
  "unclear",
  "missing",
  "not_assessed",
]);

export const liveInterviewRecruiterSummaryConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
]);

const recruiterSummaryEvidenceSchema = z.object({
  eventId: z.string().min(1),
  turnId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  speaker: liveInterviewSpeakerSchema,
  quote: z.string().trim().min(1).max(600),
});

const recruiterSummarySignalSchema = z.object({
  title: z.string().trim().min(2).max(160),
  explanation: z.string().trim().min(8).max(900),
  confidence: liveInterviewRecruiterSummaryConfidenceSchema,
  evidence: z.array(recruiterSummaryEvidenceSchema).max(3),
});

export const liveInterviewRecruiterSummarySchema = z.object({
  summaryId: z.string().min(1),
  sessionId: z.string().min(1),
  candidateId: z.string().min(1),
  planId: z.string().min(1),
  roleTitle: z.string().trim().min(2).max(160),
  status: z.enum(["complete", "incomplete"]),
  generatedAt: z.string().datetime(),
  summaryVersion: z.string().min(1).max(120),
  generator: z.enum(["deterministic_v1", "llm_assisted"]),
  disclaimer: z.string().trim().min(12).max(500),
  overview: z.string().trim().min(12).max(1000),
  recommendation: z.object({
    value: liveInterviewRecruiterSummaryRecommendationSchema,
    label: z.string().trim().min(2).max(120),
    rationale: z.string().trim().min(12).max(800),
  }),
  criteria: z
    .array(
      z.object({
        criterionId: z.string().min(1),
        label: z.string().trim().min(2).max(180),
        category: liveInterviewQuestionCategorySchema.or(z.string().min(1)),
        status: liveInterviewRecruiterSummaryCriterionStatusSchema,
        evidence: z.array(recruiterSummaryEvidenceSchema).max(3),
        note: z.string().trim().min(4).max(800),
      }),
    )
    .min(1),
  strengths: z.array(recruiterSummarySignalSchema).max(5),
  risks: z.array(recruiterSummarySignalSchema).max(5),
  questionNotes: z
    .array(
      z.object({
        questionId: z.string().min(1),
        prompt: z.string().trim().min(8).max(800),
        category: liveInterviewQuestionCategorySchema.or(z.string().min(1)),
        answerStatus: liveInterviewRecruiterSummaryCriterionStatusSchema,
        answerSummary: z.string().trim().min(4).max(900),
        evidence: z.array(recruiterSummaryEvidenceSchema).max(3),
      }),
    )
    .min(1),
  followUpQuestions: z.array(z.string().trim().min(8).max(500)).max(8),
  logisticsNotes: z.array(z.string().trim().min(4).max(500)).max(6),
  missingInformation: z.array(z.string().trim().min(4).max(500)).max(8),
  excludedSensitiveSignals: z.array(z.string().trim().min(2).max(160)).max(12),
  audit: z.object({
    sourceEventIds: z.array(z.string().min(1)),
    transcriptTurnIds: z.array(z.string().min(1)),
    templateVersion: z.string().min(1).max(120),
    generatedFromCompletedSession: z.boolean(),
  }),
});

export const liveInterviewRecruiterSummaryWireSchema = z.preprocess(
  normalizeWireKeys,
  liveInterviewRecruiterSummarySchema,
);

export type LiveInterviewProvider = z.infer<typeof liveInterviewProviderSchema>;
export type LiveInterviewMode = z.infer<typeof liveInterviewModeSchema>;
export type LiveInterviewSessionStatus = z.infer<
  typeof liveInterviewSessionStatusSchema
>;
export type LiveInterviewPlan = z.infer<typeof liveInterviewPlanSchema>;
export type LiveInterviewSession = z.infer<typeof liveInterviewSessionSchema>;
export type LiveInterviewTranscriptTurn = z.infer<
  typeof liveInterviewTranscriptTurnSchema
>;
export type LiveInterviewEventActor = z.infer<
  typeof liveInterviewEventActorSchema
>;
export type LiveInterviewAnswerClassification = z.infer<
  typeof liveInterviewAnswerClassificationSchema
>;
export type LiveInterviewPolicyAction = z.infer<
  typeof liveInterviewPolicyActionSchema
>;
export type LiveInterviewEvaluationDimension = z.infer<
  typeof liveInterviewEvaluationDimensionSchema
>;
export type LiveInterviewEvent = z.infer<typeof liveInterviewEventSchema>;
export type LiveInterviewWireEvent = z.infer<
  typeof liveInterviewWireEventSchema
>;
export type CreateLiveInterviewSessionInput = z.infer<
  typeof createLiveInterviewSessionInputSchema
>;
export type CreateLiveInterviewSessionResponse = z.infer<
  typeof createLiveInterviewSessionResponseSchema
>;
export type LiveInterviewAgentConfig = z.infer<
  typeof liveInterviewAgentConfigSchema
>;
export type LiveInterviewWorkerAgentConfig = z.infer<
  typeof liveInterviewWorkerAgentConfigSchema
>;
export type LiveInterviewRecruiterSummary = z.infer<
  typeof liveInterviewRecruiterSummarySchema
>;
