"use client";

import { CreateOrganization } from "@clerk/nextjs";
import { Trans, useTranslation } from "react-i18next";
import { StepShell } from "@prelude/ui";

export function CreateOrganizationStep() {
  const { t } = useTranslation();

  return (
    <StepShell
      eyebrow={t("onboarding.eyebrowSetup")}
      title={
        <Trans
          components={{
            em: <span className="font-display italic text-olive-700" />,
          }}
          i18nKey="onboarding.createOrgTitle"
        />
      }
      description={t("onboarding.createOrgDescription")}
    >
      {/* Clerk renders this form in its own locale, set on ClerkProvider. */}
      <CreateOrganization
        afterCreateOrganizationUrl="/onboarding/organization"
        skipInvitationScreen
      />
    </StepShell>
  );
}
