import { auth } from "@clerk/nextjs/server";

import { isConsoleAuthClerkEnabled } from "../../../../src/server/auth/clerk-config";
import { CreateOrganizationStep } from "./create-organization-step";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OrganizationOnboardingPage() {
  // With real Clerk, the workspace is a Clerk organization. If the signed-in
  // user has no active org yet, have them create one first (Clerk creates it and
  // sets it active); the wizard then links it to our DB via the session's
  // clerkOrganizationId. Mock mode has no Clerk org, so it skips to the wizard.
  if (isConsoleAuthClerkEnabled) {
    const { orgId } = await auth();
    if (!orgId) {
      return <CreateOrganizationStep />;
    }
  }

  return <OnboardingWizard />;
}
