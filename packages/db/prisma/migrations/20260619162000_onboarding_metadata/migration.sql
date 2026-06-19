-- Persist organization onboarding context and the first job source selected by the recruiter.
ALTER TABLE "Organization"
  ADD COLUMN "companySize" TEXT,
  ADD COLUMN "hiringFocus" TEXT,
  ADD COLUMN "defaultInterviewMode" TEXT,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "OrganizationMembership"
  ADD COLUMN "onboardingRole" TEXT;

ALTER TABLE "Job"
  ALTER COLUMN "description" SET DEFAULT '',
  ADD COLUMN "sourceProvider" TEXT,
  ADD COLUMN "sourceExternalId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';

CREATE INDEX "Job_organizationId_sourceProvider_idx" ON "Job"("organizationId", "sourceProvider");

CREATE TABLE "JobSourceConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "externalLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobSourceConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobSourceConnection_organizationId_provider_key"
  ON "JobSourceConnection"("organizationId", "provider");

CREATE INDEX "JobSourceConnection_provider_idx" ON "JobSourceConnection"("provider");

ALTER TABLE "JobSourceConnection"
  ADD CONSTRAINT "JobSourceConnection_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
