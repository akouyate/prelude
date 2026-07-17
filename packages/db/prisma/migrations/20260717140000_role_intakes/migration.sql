-- Role sources are staged privately before becoming visible jobs. This keeps
-- incomplete or unsafe imports out of the roles list and makes conversion
-- idempotent through the one-to-one Job relation.

ALTER TABLE "Job"
  ADD COLUMN "sourceAttachmentName" TEXT;

CREATE TABLE "RoleIntake" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL DEFAULT 'file',
  "status" TEXT NOT NULL DEFAULT 'uploading',
  "originalFileName" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "detectedMimeType" TEXT,
  "byteSize" INTEGER,
  "sha256" TEXT,
  "quarantineObjectKey" TEXT,
  "sealedObjectKey" TEXT,
  "extractedDraft" JSONB NOT NULL DEFAULT '{}',
  "reviewedDraft" JSONB NOT NULL DEFAULT '{}',
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "scannerVersion" TEXT,
  "parserVersion" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "processingLeaseExpiresAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorSummary" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "cleanupRequestedAt" TIMESTAMP(3),
  "cleanedUpAt" TIMESTAMP(3),
  "jobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoleIntake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoleIntakeEvent" (
  "id" TEXT NOT NULL,
  "roleIntakeId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoleIntakeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoleIntake_jobId_key" ON "RoleIntake"("jobId");
CREATE INDEX "RoleIntake_organizationId_status_updatedAt_idx"
  ON "RoleIntake"("organizationId", "status", "updatedAt");
CREATE INDEX "RoleIntake_organizationId_sha256_idx"
  ON "RoleIntake"("organizationId", "sha256");
CREATE INDEX "RoleIntake_status_nextAttemptAt_idx"
  ON "RoleIntake"("status", "nextAttemptAt");
CREATE INDEX "RoleIntake_createdByUserId_createdAt_idx"
  ON "RoleIntake"("createdByUserId", "createdAt");
CREATE INDEX "RoleIntakeEvent_roleIntakeId_createdAt_idx"
  ON "RoleIntakeEvent"("roleIntakeId", "createdAt");
CREATE INDEX "RoleIntakeEvent_eventType_createdAt_idx"
  ON "RoleIntakeEvent"("eventType", "createdAt");

ALTER TABLE "RoleIntake"
  ADD CONSTRAINT "RoleIntake_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleIntake"
  ADD CONSTRAINT "RoleIntake_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoleIntake"
  ADD CONSTRAINT "RoleIntake_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoleIntakeEvent"
  ADD CONSTRAINT "RoleIntakeEvent_roleIntakeId_fkey"
  FOREIGN KEY ("roleIntakeId") REFERENCES "RoleIntake"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
