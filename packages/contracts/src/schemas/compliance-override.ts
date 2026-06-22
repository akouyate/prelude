import { z } from "zod";

/**
 * N6b — reviewable override for the second-layer (LLM) protected-topic
 * classifier. The deterministic keyword gate is NEVER overridable; only a
 * genuine, materialized LLM flag can be consciously overridden by a recruiter,
 * and only with a substantive justification that is persisted as an immutable
 * audit record on the published Interview snapshot.
 *
 * The friction here is deliberate: an empty/one-word "justification" would make
 * the human-oversight nominal (an EU AI Act Art. 14 automation-bias failure), so
 * we require a real, multi-word explanation.
 */

export const COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION = 20;
export const COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION_WORDS = 4;
export const COMPLIANCE_OVERRIDE_MAX_JUSTIFICATION = 600;

const countWords = (value: string) =>
  value.split(/\s+/u).filter(Boolean).length;

export const complianceOverrideJustificationSchema = z
  .string()
  .trim()
  .min(COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION)
  .max(COMPLIANCE_OVERRIDE_MAX_JUSTIFICATION)
  .refine(
    (value) => countWords(value) >= COMPLIANCE_OVERRIDE_MIN_JUSTIFICATION_WORDS,
    {
      message:
        "Explain, in a full sentence, why this question is job-related and necessary.",
    },
  );

export const complianceOverrideRequestSchema = z.object({
  justification: complianceOverrideJustificationSchema,
});

// One overridden LLM flag. `segment` is the exact classified text so the verdict
// stays auditable against the published content (the server re-classifies the
// freshly-read draft at publish time, so this is never a stale, client-supplied
// verdict). `category` stays a plain string to avoid coupling @prelude/contracts
// to the @prelude/core protected-topic enum — it is already constrained upstream.
export const complianceOverrideFlagSchema = z.object({
  category: z.string().min(1),
  reason: z.string(),
  segment: z.string().min(1),
});

export const complianceOverrideRecordSchema = z.object({
  justification: z.string().min(1),
  overriddenByUserId: z.string().min(1),
  organizationId: z.string().min(1),
  overriddenAt: z.string().min(1),
  classifierProvider: z.string().min(1),
  classifierModel: z.string().min(1),
  classifierPromptVersion: z.string().min(1),
  classifierSchemaVersion: z.string().min(1),
  // The override is only ever applied AFTER the authoritative keyword gate has
  // passed; persisting this literal proves the hard block was not bypassed.
  keywordGatePassed: z.literal(true),
  flags: z.array(complianceOverrideFlagSchema).min(1),
});

export type ComplianceOverrideRequest = z.infer<
  typeof complianceOverrideRequestSchema
>;
export type ComplianceOverrideFlag = z.infer<typeof complianceOverrideFlagSchema>;
export type ComplianceOverrideRecord = z.infer<
  typeof complianceOverrideRecordSchema
>;
