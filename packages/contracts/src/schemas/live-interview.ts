import { z } from "zod";

export const liveInterviewProviderSchema = z.enum([
  "openai_realtime",
  "elevenlabs",
  "mock"
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
  "expired"
]);

export const liveInterviewSpeakerSchema = z.enum([
  "candidate",
  "interviewer",
  "system"
]);

export const liveInterviewQuestionCategorySchema = z.enum([
  "motivation",
  "experience",
  "skills",
  "logistics",
  "availability",
  "compensation",
  "custom"
]);

export const liveInterviewQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(8).max(800),
  category: liveInterviewQuestionCategorySchema.default("custom"),
  expectedSignal: z.string().trim().min(4).max(500).optional(),
  required: z.boolean().default(true),
  maxFollowups: z.number().int().min(0).max(1).default(1)
});

export const liveInterviewPlanSchema = z.object({
  planId: z.string().min(1),
  jobId: z.string().min(1),
  roleTitle: z.string().trim().min(2).max(160),
  locale: z.string().min(2).default("fr-FR"),
  candidateModes: z.array(liveInterviewModeSchema).min(1).max(3),
  questions: z.array(liveInterviewQuestionSchema).min(1).max(8)
});

export const liveInterviewSessionSchema = z.object({
  sessionId: z.string().min(1),
  candidateId: z.string().min(1),
  planId: z.string().min(1),
  status: liveInterviewSessionStatusSchema,
  livekitRoomName: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
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
  confidence: z.number().min(0).max(1).optional()
});

const liveInterviewEventBaseSchema = z.object({
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  sequence: z.number().int().min(0),
  idempotencyKey: z.string().min(8),
  occurredAt: z.string().datetime()
});

export const liveInterviewEventSchema = z.discriminatedUnion("type", [
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_started"),
    payload: z.object({
      provider: liveInterviewProviderSchema,
      agentParticipantId: z.string().min(1)
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_joined"),
    payload: z.object({
      candidateParticipantId: z.string().min(1),
      modes: z.array(liveInterviewModeSchema).min(1).max(3)
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("agent_joined"),
    payload: z.object({
      agentParticipantId: z.string().min(1),
      provider: liveInterviewProviderSchema
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("question_asked"),
    payload: z.object({
      questionId: z.string().min(1),
      questionIndex: z.number().int().min(0),
      prompt: z.string().trim().min(8).max(800)
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_turn_started"),
    payload: z.object({
      questionId: z.string().min(1).optional()
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("candidate_turn_finalized"),
    payload: z.object({
      questionId: z.string().min(1),
      transcriptTurn: liveInterviewTranscriptTurnSchema
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("followup_asked"),
    payload: z.object({
      questionId: z.string().min(1),
      followupId: z.string().min(1),
      prompt: z.string().trim().min(8).max(800)
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("question_completed"),
    payload: z.object({
      questionId: z.string().min(1),
      completionReason: z.enum([
        "answered",
        "skipped",
        "candidate_silent",
        "timeboxed"
      ])
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_completed"),
    payload: z.object({
      completedReason: z.enum([
        "all_questions_completed",
        "candidate_ended",
        "timeboxed"
      ])
    })
  }),
  liveInterviewEventBaseSchema.extend({
    type: z.literal("session_failed"),
    payload: z.object({
      code: z.string().min(2).max(80),
      message: z.string().min(1).max(500),
      retryable: z.boolean().default(false)
    })
  })
]);

export const createLiveInterviewSessionInputSchema = z.object({
  candidateToken: z.string().min(8),
  planId: z.string().min(1)
});

export const createLiveInterviewSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: liveInterviewSessionStatusSchema,
  livekitRoomName: z.string().min(1),
  candidateLivekitToken: z.string().min(1),
  expiresAt: z.string().datetime()
});

export const liveInterviewAgentConfigSchema = z.object({
  session: liveInterviewSessionSchema,
  plan: liveInterviewPlanSchema,
  agentLivekitToken: z.string().min(1),
  provider: liveInterviewProviderSchema
});

export type LiveInterviewProvider = z.infer<
  typeof liveInterviewProviderSchema
>;
export type LiveInterviewMode = z.infer<typeof liveInterviewModeSchema>;
export type LiveInterviewSessionStatus = z.infer<
  typeof liveInterviewSessionStatusSchema
>;
export type LiveInterviewPlan = z.infer<typeof liveInterviewPlanSchema>;
export type LiveInterviewSession = z.infer<typeof liveInterviewSessionSchema>;
export type LiveInterviewTranscriptTurn = z.infer<
  typeof liveInterviewTranscriptTurnSchema
>;
export type LiveInterviewEvent = z.infer<typeof liveInterviewEventSchema>;
export type CreateLiveInterviewSessionInput = z.infer<
  typeof createLiveInterviewSessionInputSchema
>;
export type CreateLiveInterviewSessionResponse = z.infer<
  typeof createLiveInterviewSessionResponseSchema
>;
export type LiveInterviewAgentConfig = z.infer<
  typeof liveInterviewAgentConfigSchema
>;
