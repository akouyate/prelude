import { z } from "zod";

import { interviewPlanSchema } from "./interview-plan";
import { workspaceLanguageSchema } from "./organization";

export const CANDIDATE_PREVIEW_SCHEMA_VERSION = 2 as const;

export const candidatePreviewVariantSchema = z.enum([
  "recruiter_preview",
  "marketing_demo",
]);

const postInterviewQuestionBaseSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  prompt: z.string().trim().min(4).max(300),
  required: z.boolean().default(true),
});

export const marketingDemoPostInterviewQuestionSchema = z.discriminatedUnion(
  "type",
  [
    postInterviewQuestionBaseSchema.extend({
      type: z.literal("short_text"),
      maxLength: z.number().int().min(20).max(800).default(400),
    }),
    postInterviewQuestionBaseSchema.extend({
      type: z.literal("single_select"),
      options: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(120),
            value: z
              .string()
              .trim()
              .min(1)
              .max(80)
              .regex(/^[a-z0-9][a-z0-9_-]*$/),
          }),
        )
        .min(2)
        .max(8),
    }),
    postInterviewQuestionBaseSchema
      .extend({
        type: z.literal("scale"),
        min: z.number().int().min(0).max(9).default(1),
        max: z.number().int().min(1).max(10).default(5),
        minLabel: z.string().trim().min(1).max(80),
        maxLabel: z.string().trim().min(1).max(80),
      })
      .refine((question) => question.max > question.min, {
        message: "Scale maximum must be greater than minimum.",
        path: ["max"],
      }),
  ],
);

export const marketingDemoPostInterviewQuestionsSchema = z
  .array(marketingDemoPostInterviewQuestionSchema)
  .min(1)
  .max(6)
  .superRefine((questions, context) => {
    const ids = new Set<string>();
    for (const [index, question] of questions.entries()) {
      if (ids.has(question.id)) {
        context.addIssue({
          code: "custom",
          message: "Question ids must be unique.",
          path: [index, "id"],
        });
      }
      ids.add(question.id);
    }
  });

export const marketingDemoPublicRoleSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  badge: z.string().trim().min(1).max(80).nullable(),
  locale: workspaceLanguageSchema,
  version: z.number().int().positive(),
});

export const marketingDemoRolesResponseSchema = z.object({
  roles: z.array(marketingDemoPublicRoleSchema).max(12),
  launchNonce: z.string().trim().min(32).max(160),
  launchNonceExpiresAt: z.string().datetime(),
});

export const marketingDemoSessionAdmissionSchema = z
  .object({
    roleSlug: z.string().trim().min(1).max(80),
    botProof: z.string().trim().min(1).max(4096),
    launchNonce: z.string().trim().min(32).max(160),
    returnTarget: z.string().url().max(2048),
  })
  .strict();

export const marketingDemoServiceAdmissionSchema = z
  .object({
    roleSlug: z.string().trim().min(1).max(80),
    botProofVerified: z.literal(true),
    launchNonce: z.string().trim().min(32).max(160),
    returnTarget: z.string().url().max(2048),
  })
  .strict();

export const marketingDemoPostInterviewAnswerSchema = z
  .object({
    questionId: z.string().trim().min(1).max(80),
    value: z.union([
      z.string().trim().max(800),
      z.number().int().min(0).max(10),
    ]),
  })
  .strict();

export const marketingDemoHandoffSubmissionSchema = z
  .object({
    answers: z.array(marketingDemoPostInterviewAnswerSchema).max(6),
    previewToken: z.string().trim().min(32).max(160),
    sessionId: z.string().trim().min(1).max(160),
  })
  .strict();

export const marketingDemoHandoffExchangeSchema = z
  .object({
    code: z.string().trim().min(32).max(160),
    returnTarget: z.string().url().max(2048),
  })
  .strict();

const candidatePreviewDisplaySchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  jobId: z.string().trim().min(1),
  jobTitle: z.string().trim().min(1).max(200),
  plan: interviewPlanSchema,
});

const candidateExperiencePreviewSnapshotV1Schema =
  candidatePreviewDisplaySchema.extend({
    schemaVersion: z.literal(1).default(1),
  });

const recruiterPreviewSnapshotV2Schema = candidatePreviewDisplaySchema.extend({
  schemaVersion: z.literal(CANDIDATE_PREVIEW_SCHEMA_VERSION),
  variant: z.literal("recruiter_preview"),
});

const marketingDemoSnapshotV2Schema = candidatePreviewDisplaySchema.extend({
  schemaVersion: z.literal(CANDIDATE_PREVIEW_SCHEMA_VERSION),
  variant: z.literal("marketing_demo"),
  marketingDemo: z.object({
    launchNonceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    locale: workspaceLanguageSchema,
    postInterviewQuestions: marketingDemoPostInterviewQuestionsSchema,
    returnTarget: z.string().url().max(2048),
    roleSlug: z.string().trim().min(1).max(80),
    roleVersion: z.number().int().positive(),
  }),
});

export const candidateExperiencePreviewSnapshotSchema = z.union([
  candidateExperiencePreviewSnapshotV1Schema,
  recruiterPreviewSnapshotV2Schema,
  marketingDemoSnapshotV2Schema,
]);

export type CandidatePreviewVariant = z.infer<
  typeof candidatePreviewVariantSchema
>;
export type MarketingDemoPostInterviewQuestion = z.infer<
  typeof marketingDemoPostInterviewQuestionSchema
>;
export type MarketingDemoPublicRole = z.infer<
  typeof marketingDemoPublicRoleSchema
>;

export type CandidateExperiencePreviewSnapshot = z.infer<
  typeof candidateExperiencePreviewSnapshotSchema
>;
