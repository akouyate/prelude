-- URL sources retain only sanitized provenance and deterministic extracted
-- fields. Raw HTML and request metadata are deliberately never stored.

ALTER TABLE "RoleIntake"
  ADD COLUMN "submittedUrl" TEXT,
  ADD COLUMN "canonicalUrl" TEXT,
  ADD COLUMN "sourceIdentity" TEXT,
  ADD COLUMN "sourceMetadata" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId" TEXT;

CREATE UNIQUE INDEX "RoleIntake_organizationId_sourceIdentity_key"
  ON "RoleIntake"("organizationId", "sourceIdentity");
