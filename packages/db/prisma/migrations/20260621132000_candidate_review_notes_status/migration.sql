ALTER TABLE "CandidateSession"
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reviewStatusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "reviewStatusUpdatedById" TEXT,
  ADD COLUMN "reviewNoteUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNoteUpdatedById" TEXT;

CREATE TABLE "CandidateSessionReviewEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateSessionId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "previousStatus" TEXT,
  "nextStatus" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CandidateSessionReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CandidateSession_organizationId_reviewStatus_updatedAt_idx"
  ON "CandidateSession"("organizationId", "reviewStatus", "updatedAt");

CREATE INDEX "CandidateSession_reviewStatusUpdatedById_idx"
  ON "CandidateSession"("reviewStatusUpdatedById");

CREATE INDEX "CandidateSession_reviewNoteUpdatedById_idx"
  ON "CandidateSession"("reviewNoteUpdatedById");

CREATE INDEX "CandidateSessionReviewEvent_candidateSessionId_createdAt_idx"
  ON "CandidateSessionReviewEvent"("candidateSessionId", "createdAt");

CREATE INDEX "CandidateSessionReviewEvent_organizationId_createdAt_idx"
  ON "CandidateSessionReviewEvent"("organizationId", "createdAt");

CREATE INDEX "CandidateSessionReviewEvent_authorUserId_createdAt_idx"
  ON "CandidateSessionReviewEvent"("authorUserId", "createdAt");

ALTER TABLE "CandidateSession"
  ADD CONSTRAINT "CandidateSession_reviewStatusUpdatedById_fkey"
  FOREIGN KEY ("reviewStatusUpdatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CandidateSession"
  ADD CONSTRAINT "CandidateSession_reviewNoteUpdatedById_fkey"
  FOREIGN KEY ("reviewNoteUpdatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CandidateSessionReviewEvent"
  ADD CONSTRAINT "CandidateSessionReviewEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateSessionReviewEvent"
  ADD CONSTRAINT "CandidateSessionReviewEvent_candidateSessionId_fkey"
  FOREIGN KEY ("candidateSessionId") REFERENCES "CandidateSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateSessionReviewEvent"
  ADD CONSTRAINT "CandidateSessionReviewEvent_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
