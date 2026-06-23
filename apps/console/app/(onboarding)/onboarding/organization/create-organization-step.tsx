"use client";

import { CreateOrganization } from "@clerk/nextjs";
import { StepShell } from "@prelude/ui";

export function CreateOrganizationStep() {
  return (
    <StepShell
      eyebrow="Workspace setup"
      title={
        <>
          Create your{" "}
          <span className="font-display italic text-olive-700">workspace</span>.
        </>
      }
      description="Name your organization to get started — you can invite your team right after."
    >
      <CreateOrganization
        afterCreateOrganizationUrl="/onboarding/organization"
        skipInvitationScreen
      />
    </StepShell>
  );
}
