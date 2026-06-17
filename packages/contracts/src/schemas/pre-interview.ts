import { z } from "zod";

export const preInterviewQuestionSchema = z.object({
  prompt: z.string().trim().min(12).max(500),
  expectedSignal: z.string().trim().min(8).max(300),
  maxDurationSeconds: z.number().int().min(30).max(180).default(90)
});

export const evaluationCriterionSchema = z.object({
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().min(8).max(240)
});

export const generatePreInterviewInputSchema = z.object({
  jobId: z.string().uuid(),
  jobDescription: z.string().trim().min(80).max(12000)
});

export const publicCandidatePayloadSchema = z.object({
  token: z.string().min(8),
  jobTitle: z.string(),
  companyName: z.string(),
  questions: z.array(preInterviewQuestionSchema).min(1).max(5)
});

export type GeneratePreInterviewInput = z.infer<
  typeof generatePreInterviewInputSchema
>;
export type PublicCandidatePayload = z.infer<
  typeof publicCandidatePayloadSchema
>;
