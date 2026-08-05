import { z } from "zod";

export const roleIntakeSourceKindSchema = z.enum(["file", "url"]);
export const roleIntakeSourceRetentionSchema = z.enum([
  "pending_deletion",
  "deleted",
  "not_stored",
]);

export const roleIntakeStatusSchema = z.enum([
  "uploading",
  "quarantined",
  "queued",
  "processing",
  "ready_for_review",
  "failed",
  "consumed",
  "expired",
  "deleted",
]);

/**
 * Every acquisition path clamps a draft to these limits before persisting it, so
 * they are named here rather than repeated as literals next to each extractor.
 */
export const roleIntakeDraftLimits = {
  description: 500_000,
  location: 160,
  title: 160,
} as const;

export const importedRoleDraftSchema = z.object({
  description: z
    .string()
    .trim()
    .max(roleIntakeDraftLimits.description)
    .default(""),
  location: z
    .string()
    .trim()
    .max(roleIntakeDraftLimits.location)
    .nullable()
    .default(null),
  title: z
    .string()
    .trim()
    .max(roleIntakeDraftLimits.title)
    .nullable()
    .default(null),
});

export const roleIntakeWarningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(240),
});

export const roleIntakeFieldSourceSchema = z.enum([
  "ats_public_api",
  "indexed_web_search",
  "job_posting_json_ld",
  "main_content",
  "heading",
  "page_title",
  "unavailable",
]);

export const roleIntakeAcquisitionStrategySchema = z.enum([
  "ats_api",
  "direct_html",
  "indexed_search",
]);

export const roleIntakeFieldSourcesSchema = z.object({
  description: roleIntakeFieldSourceSchema,
  location: roleIntakeFieldSourceSchema,
  title: roleIntakeFieldSourceSchema,
});

export const roleIntakeSourceProvenanceSchema = z.object({
  acquisitionStrategy: roleIntakeAcquisitionStrategySchema
    .nullable()
    .default(null),
  canonicalUrl: z.string().url().max(2_048).nullable().default(null),
  citationUrls: z.array(z.string().url().max(2_048)).max(20).default([]),
  displayName: z.string().trim().min(1).max(255),
  extractorVersion: z.string().trim().min(1).max(80).nullable().default(null),
  fetchedAt: z.string().datetime().nullable().default(null),
  fieldSources: roleIntakeFieldSourcesSchema.nullable().default(null),
  submittedUrl: z.string().url().max(2_048).nullable().default(null),
});

export const roleIntakeSummarySchema = z.object({
  duplicateOfIntakeId: z.string().min(1).nullable().default(null),
  expiresAt: z.string().datetime(),
  failureCode: z.string().trim().min(1).max(80).nullable().default(null),
  failureMessage: z.string().trim().min(1).max(240).nullable().default(null),
  id: z.string().min(1),
  originalFileName: z.string().min(1).max(255),
  reviewVersion: z.number().int().nonnegative().default(0),
  reviewedDraft: importedRoleDraftSchema,
  source: roleIntakeSourceProvenanceSchema,
  sourceKind: roleIntakeSourceKindSchema,
  sourceRetention: roleIntakeSourceRetentionSchema.default("pending_deletion"),
  status: roleIntakeStatusSchema,
  warnings: z.array(roleIntakeWarningSchema),
});

export type ImportedRoleDraft = z.infer<typeof importedRoleDraftSchema>;
export type RoleIntakeSourceKind = z.infer<typeof roleIntakeSourceKindSchema>;
export type RoleIntakeSourceRetention = z.infer<
  typeof roleIntakeSourceRetentionSchema
>;
export type RoleIntakeAcquisitionStrategy = z.infer<
  typeof roleIntakeAcquisitionStrategySchema
>;
export type RoleIntakeStatus = z.infer<typeof roleIntakeStatusSchema>;
export type RoleIntakeSummary = z.infer<typeof roleIntakeSummarySchema>;
export type RoleIntakeWarning = z.infer<typeof roleIntakeWarningSchema>;
export type RoleIntakeFieldSource = z.infer<typeof roleIntakeFieldSourceSchema>;
export type RoleIntakeSourceProvenance = z.infer<
  typeof roleIntakeSourceProvenanceSchema
>;
