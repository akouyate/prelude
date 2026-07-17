import { z } from "zod";

export const roleIntakeSourceKindSchema = z.literal("file");

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

export const roleIntakeSummarySchema = z.object({
  expiresAt: z.string().datetime(),
  id: z.string().min(1),
  originalFileName: z.string().min(1).max(255),
  reviewedDraft: importedRoleDraftSchema,
  sourceKind: roleIntakeSourceKindSchema,
  status: roleIntakeStatusSchema,
  warnings: z.array(roleIntakeWarningSchema),
});

export type ImportedRoleDraft = z.infer<typeof importedRoleDraftSchema>;
export type RoleIntakeSourceKind = z.infer<typeof roleIntakeSourceKindSchema>;
export type RoleIntakeStatus = z.infer<typeof roleIntakeStatusSchema>;
export type RoleIntakeSummary = z.infer<typeof roleIntakeSummarySchema>;
export type RoleIntakeWarning = z.infer<typeof roleIntakeWarningSchema>;
