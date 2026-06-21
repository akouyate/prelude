import { z } from "zod";

export const reviewStatusSchema = z.enum(["to_call", "to_review", "archived"]);

export const candidateBriefStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const candidateCriterionEvaluationStatusSchema = z.enum([
  "Strong",
  "Medium",
  "Weak",
  "Not assessable",
]);

export const candidateBriefEvaluationStatusSchema = z.enum([
  "satisfied",
  "partial",
  "unclear",
  "missing",
  "risk",
]);

export const candidateBriefConfidenceSchema = z.enum([
  "low",
  "medium",
  "high",
]);

export const candidateBriefCriterionCategorySchema = z.enum([
  "experience",
  "motivation",
  "availability",
  "logistics",
  "communication",
  "role_specific",
]);

export const candidateBriefRecommendationLabelSchema = z.enum([
  "continue",
  "targeted_follow_up",
  "inconclusive",
]);

export const candidateBriefRecommendedNextStepSchema = z.enum([
  "to_call",
  "to_review",
]);

export const complianceFlagSchema = z.enum([
  "biometric_scoring_disallowed",
  "human_review_required",
  "job_related_questions_only",
  "protected_traits_excluded",
  "sensitive_signal_review_required",
]);

export const candidateBriefEvidenceSchema = z.object({
  eventId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(1200),
  transcriptTurnId: z.string().min(1).optional(),
});

export const candidateCriterionEvaluationSchema = z.object({
  criterionId: z.string().min(1),
  label: z.string().trim().min(2).max(120),
  status: candidateCriterionEvaluationStatusSchema,
  rationale: z.string().trim().min(1).max(800),
  evidence: z.array(candidateBriefEvidenceSchema).max(4).default([]),
});

export const candidateBriefEvaluationCriterionSchema = z.object({
  criterionId: z.string().min(1),
  label: z.string().trim().min(2).max(120),
  category: candidateBriefCriterionCategorySchema.optional(),
  status: candidateBriefEvaluationStatusSchema,
  confidence: candidateBriefConfidenceSchema,
  rationale: z.string().trim().min(1).max(800),
  evidence: z.array(candidateBriefEvidenceSchema).max(4).default([]),
  missingInfo: z.array(z.string().trim().min(3).max(180)).max(6).default([]),
  followUps: z.array(z.string().trim().min(3).max(220)).max(6).default([]),
});

export const candidateBriefInferredSignalSchema = z.object({
  label: z.string().trim().min(2).max(140),
  confidence: candidateBriefConfidenceSchema,
  evidence: z.array(candidateBriefEvidenceSchema).max(4).default([]),
});

export const candidateBriefEvaluationMatrixSchema = z.object({
  criteria: z
    .array(candidateBriefEvaluationCriterionSchema)
    .max(12)
    .default([]),
  facts: z.array(z.string().trim().min(3).max(220)).max(8).default([]),
  inferredSignals: z
    .array(candidateBriefInferredSignalSchema)
    .max(8)
    .default([]),
  risks: z.array(z.string().trim().min(3).max(220)).max(8).default([]),
  missingInfo: z.array(z.string().trim().min(3).max(220)).max(8).default([]),
  recommendedNextStep: candidateBriefRecommendedNextStepSchema,
  recommendationLabel: candidateBriefRecommendationLabelSchema,
  recommendationConfidence: candidateBriefConfidenceSchema,
  recommendationRationale: z.string().trim().min(1).max(800),
});

export const candidateBriefSchema = z.object({
  candidateSessionId: z.string().min(1),
  status: candidateBriefStatusSchema,
  summary: z.string().trim().min(20).max(1200).optional(),
  strengths: z.array(z.string().trim().min(3).max(180)).max(6).default([]),
  risks: z.array(z.string().trim().min(3).max(180)).max(6).default([]),
  pointsToClarify: z
    .array(z.string().trim().min(3).max(220))
    .max(8)
    .default([]),
  criteria: z.array(candidateCriterionEvaluationSchema).max(8).default([]),
  evaluationMatrix: candidateBriefEvaluationMatrixSchema.optional(),
  limitations: z.array(z.string().trim().min(3).max(220)).max(8).default([]),
  complianceFlags: z.array(complianceFlagSchema).max(12).default([]),
  suggestedNextStep: reviewStatusSchema.optional(),
});

export type CandidateBriefDto = z.infer<typeof candidateBriefSchema>;
