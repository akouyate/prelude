import { z } from "zod";

export const organizationOnboardingStepSchema = z.enum([
  "welcome",
  "company",
  "size",
  "role",
  "focus",
  "source",
  "jobs",
  "mode",
  "ready",
]);

export const organizationOnboardingJobSourceSchema = z.enum([
  "linkedin",
  "indeed",
  "manual",
]);

export const organizationOnboardingStateSchema = z.object({
  companyName: z.string().trim().max(120).default(""),
  companySize: z.string().trim().max(40).default(""),
  hiringFocus: z.string().trim().max(80).default(""),
  interviewMode: z.string().trim().max(80).default("Voice first"),
  jobSource: z
    .union([organizationOnboardingJobSourceSchema, z.literal("")])
    .default(""),
  manualJobTitle: z.string().trim().max(160).default(""),
  onboardingRole: z.string().trim().max(80).default(""),
  selectedJobId: z.string().trim().max(160).default(""),
});

export const saveOrganizationOnboardingProgressInputSchema = z.object({
  clientRevision: z.number().int().nonnegative().default(0),
  currentStep: organizationOnboardingStepSchema,
  state: organizationOnboardingStateSchema,
});

export type OrganizationOnboardingJobSource = z.infer<
  typeof organizationOnboardingJobSourceSchema
>;
export type OrganizationOnboardingState = z.infer<
  typeof organizationOnboardingStateSchema
>;
export type OrganizationOnboardingStep = z.infer<
  typeof organizationOnboardingStepSchema
>;
export type SaveOrganizationOnboardingProgressInput = z.infer<
  typeof saveOrganizationOnboardingProgressInputSchema
>;
