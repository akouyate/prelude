import { z } from "zod";

export const roleIntakeSourceKindSchema = z.enum(["file", "url"]);

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

export const importedRoleDraftSchema = z.object({
  description: z.string().trim().max(500_000).default(""),
  location: z.string().trim().max(160).nullable().default(null),
  title: z.string().trim().max(160).nullable().default(null),
});

export const roleIntakeWarningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(240),
});

export const roleIntakeFieldSourceSchema = z.enum([
  "job_posting_json_ld",
  "main_content",
  "heading",
  "page_title",
  "unavailable",
]);

export const roleIntakeSourceProvenanceSchema = z.object({
  canonicalUrl: z.string().url().max(2_048).nullable().default(null),
  displayName: z.string().trim().min(1).max(255),
  extractorVersion: z.string().trim().min(1).max(80).nullable().default(null),
  fetchedAt: z.string().datetime().nullable().default(null),
  fieldSources: z
    .object({
      description: roleIntakeFieldSourceSchema,
      location: roleIntakeFieldSourceSchema,
      title: roleIntakeFieldSourceSchema,
    })
    .nullable()
    .default(null),
  submittedUrl: z.string().url().max(2_048).nullable().default(null),
});

export const roleIntakeSummarySchema = z.object({
  duplicateOfIntakeId: z.string().min(1).nullable().default(null),
  expiresAt: z.string().datetime(),
  failureMessage: z.string().trim().min(1).max(240).nullable().default(null),
  id: z.string().min(1),
  originalFileName: z.string().min(1).max(255),
  reviewVersion: z.number().int().nonnegative().default(0),
  reviewedDraft: importedRoleDraftSchema,
  source: roleIntakeSourceProvenanceSchema,
  sourceKind: roleIntakeSourceKindSchema,
  status: roleIntakeStatusSchema,
  warnings: z.array(roleIntakeWarningSchema),
});

export type ImportedRoleDraft = z.infer<typeof importedRoleDraftSchema>;
export type RoleIntakeSourceKind = z.infer<typeof roleIntakeSourceKindSchema>;
export type RoleIntakeStatus = z.infer<typeof roleIntakeStatusSchema>;
export type RoleIntakeSummary = z.infer<typeof roleIntakeSummarySchema>;
export type RoleIntakeWarning = z.infer<typeof roleIntakeWarningSchema>;
export type RoleIntakeFieldSource = z.infer<typeof roleIntakeFieldSourceSchema>;
export type RoleIntakeSourceProvenance = z.infer<typeof roleIntakeSourceProvenanceSchema>;
