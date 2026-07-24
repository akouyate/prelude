-- Clerk remains the billing authority. Prelude persists only the normalized
-- organization subscription projection needed by public product flows.
CREATE TABLE "OrganizationBillingState" (
    "organizationId" TEXT NOT NULL,
    "clerkSubscriptionId" TEXT,
    "clerkPlanId" TEXT,
    "planSlug" TEXT,
    "planName" TEXT,
    "state" TEXT NOT NULL,
    "subscriptionStatus" TEXT,
    "subscriptionItemId" TEXT,
    "subscriptionItemStatus" TEXT,
    "isFreeTrial" BOOLEAN NOT NULL DEFAULT false,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationBillingState_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "OrganizationBillingState_state_periodEnd_idx"
ON "OrganizationBillingState"("state", "periodEnd");

ALTER TABLE "OrganizationBillingState"
ADD CONSTRAINT "OrganizationBillingState_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateSession"
ADD COLUMN "recordingEntitled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "CandidateSession_organizationId_startedAt_idx"
ON "CandidateSession"("organizationId", "startedAt");
