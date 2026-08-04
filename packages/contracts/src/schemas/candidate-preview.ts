import { z } from "zod";

import { interviewPlanSchema } from "./interview-plan";

export const CANDIDATE_PREVIEW_SCHEMA_VERSION = 1 as const;

export const candidateExperiencePreviewSnapshotSchema = z.object({
  schemaVersion: z
    .literal(CANDIDATE_PREVIEW_SCHEMA_VERSION)
    .default(CANDIDATE_PREVIEW_SCHEMA_VERSION),
  companyName: z.string().trim().min(1).max(200),
  jobId: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1).max(200),
  plan: interviewPlanSchema,
});

export type CandidateExperiencePreviewSnapshot = z.infer<
  typeof candidateExperiencePreviewSnapshotSchema
>;
