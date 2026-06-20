import { describe, expect, it } from "vitest";

import {
  organizationOnboardingStateSchema,
  saveOrganizationOnboardingProgressInputSchema,
} from "./onboarding";

describe("organizationOnboardingStateSchema", () => {
  it("normalizes a partial resumable onboarding state", () => {
    const result = organizationOnboardingStateSchema.parse({
      companyName: "  Acme Talent  ",
      jobSource: "linkedin",
      onboardingRole: "Recruiter",
    });

    expect(result).toEqual({
      companyName: "Acme Talent",
      companySize: "",
      hiringFocus: "",
      interviewMode: "Voice first",
      jobSource: "linkedin",
      manualJobTitle: "",
      onboardingRole: "Recruiter",
      selectedJobId: "",
    });
  });

  it("rejects unsupported job sources", () => {
    const result = saveOrganizationOnboardingProgressInputSchema.safeParse({
      currentStep: "source",
      state: {
        companyName: "Acme Talent",
        jobSource: "monster",
      },
    });

    expect(result.success).toBe(false);
  });
});
