import { z } from "zod";

export const candidateAnswerModeSchema = z.enum(["audio", "video", "text"]);

export const candidateAnswerSchema = z.object({
  questionId: z.string().min(1),
  mode: candidateAnswerModeSchema,
  transcript: z.string().trim().max(4000).optional(),
  text: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().url().optional()
});

export const candidateSubmissionSchema = z.object({
  token: z.string().min(8),
  candidate: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().email()
  }),
  answers: z.array(candidateAnswerSchema).min(1).max(8)
});

export const transcriptionResponseSchema = z.object({
  answerId: z.string(),
  transcript: z.string(),
  language: z.string().default("fr")
});

export type CandidateSubmissionInput = z.infer<
  typeof candidateSubmissionSchema
>;
export type TranscriptionResponse = z.infer<
  typeof transcriptionResponseSchema
>;
