import { z } from "zod";

export const reviewStatusSchema = z.enum(["to_call", "to_review", "archived"]);

export const candidateBriefSchema = z.object({
  candidateId: z.string().uuid(),
  summary: z.string().trim().min(20).max(1200),
  strengths: z.array(z.string().trim().min(3).max(180)).max(6),
  risks: z.array(z.string().trim().min(3).max(180)).max(6),
  suggestedNextStep: reviewStatusSchema
});

export type CandidateBriefDto = z.infer<typeof candidateBriefSchema>;
