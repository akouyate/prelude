-- V1 domain spine: make CandidateSession the recruiter/candidate product
-- aggregate, keep realtime sessions as external runtime evidence, and persist
-- candidate briefs separately from live events.

ALTER TABLE "CandidateSession"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'to_review';

UPDATE "CandidateSession" AS cs
SET "jobId" = i."jobId"
FROM "Interview" AS i
WHERE cs."interviewId" = i."id";

ALTER TABLE "CandidateSession"
  ALTER COLUMN "jobId" SET NOT NULL;

CREATE TABLE "CandidateBrief" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateSessionId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summaryJson" JSONB NOT NULL DEFAULT '{}',
  "recommendation" TEXT,
  "limitations" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "modelProvider" TEXT,
  "modelName" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "generatedAt" TIMESTAMP(3),
  "failedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateBrief_candidateSessionId_key"
  ON "CandidateBrief"("candidateSessionId");

CREATE INDEX "CandidateBrief_organizationId_status_updatedAt_idx"
  ON "CandidateBrief"("organizationId", "status", "updatedAt");

CREATE INDEX "CandidateSession_jobId_status_idx"
  ON "CandidateSession"("jobId", "status");

ALTER TABLE "CandidateSession"
  ADD CONSTRAINT "CandidateSession_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateBrief"
  ADD CONSTRAINT "CandidateBrief_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateBrief"
  ADD CONSTRAINT "CandidateBrief_candidateSessionId_fkey"
  FOREIGN KEY ("candidateSessionId") REFERENCES "CandidateSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
