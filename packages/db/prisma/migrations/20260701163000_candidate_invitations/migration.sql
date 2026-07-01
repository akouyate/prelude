-- Candidate invitations are the public V1 candidate entry point. They keep
-- invite expiry and consent/open audit separate from the published Interview
-- plan snapshot.
CREATE TABLE "CandidateInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "interviewId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "candidateName" TEXT,
  "candidateEmail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'invited',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "openedAt" TIMESTAMP(3),
  "consentedAt" TIMESTAMP(3),
  "consentCopyVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateInvitation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CandidateSession"
  ADD COLUMN "candidateInvitationId" TEXT;

CREATE UNIQUE INDEX "CandidateInvitation_token_key"
  ON "CandidateInvitation"("token");

CREATE INDEX "CandidateInvitation_organizationId_status_expiresAt_idx"
  ON "CandidateInvitation"("organizationId", "status", "expiresAt");

CREATE INDEX "CandidateInvitation_interviewId_status_idx"
  ON "CandidateInvitation"("interviewId", "status");

CREATE INDEX "CandidateInvitation_jobId_status_idx"
  ON "CandidateInvitation"("jobId", "status");

CREATE INDEX "CandidateSession_candidateInvitationId_status_idx"
  ON "CandidateSession"("candidateInvitationId", "status");

CREATE UNIQUE INDEX "CandidateSession_active_invitation_attempt_key"
  ON "CandidateSession"("candidateInvitationId")
  WHERE "candidateInvitationId" IS NOT NULL
    AND "status" IN (
      'agent_joining',
      'in_progress',
      'paused',
      'reconnecting',
      'started',
      'starting',
      'waiting_candidate'
    );

ALTER TABLE "CandidateInvitation"
  ADD CONSTRAINT "CandidateInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateInvitation"
  ADD CONSTRAINT "CandidateInvitation_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateInvitation"
  ADD CONSTRAINT "CandidateInvitation_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "Interview"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CandidateSession"
  ADD CONSTRAINT "CandidateSession_candidateInvitationId_fkey"
  FOREIGN KEY ("candidateInvitationId") REFERENCES "CandidateInvitation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
