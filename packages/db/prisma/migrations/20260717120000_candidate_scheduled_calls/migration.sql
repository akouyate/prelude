CREATE TABLE "CandidateScheduledCall" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "candidateSessionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "connectedAccountId" TEXT,
  "activeScheduleKey" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'google_calendar',
  "providerCalendarId" TEXT NOT NULL DEFAULT 'primary',
  "providerEventId" TEXT NOT NULL,
  "providerEventUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'creating',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "attendeeEmails" JSONB NOT NULL DEFAULT '[]',
  "inviteCandidate" BOOLEAN NOT NULL DEFAULT false,
  "conferenceRequested" BOOLEAN NOT NULL DEFAULT false,
  "location" TEXT,
  "conferenceJoinUrl" TEXT,
  "lastProviderErrorCode" TEXT,
  "lastProviderErrorAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateScheduledCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CandidateScheduledCall_activeScheduleKey_key"
  ON "CandidateScheduledCall"("activeScheduleKey");
CREATE UNIQUE INDEX "CandidateScheduledCall_connectedAccountId_providerCalendarId_providerEventId_key"
  ON "CandidateScheduledCall"("connectedAccountId", "providerCalendarId", "providerEventId");
CREATE INDEX "CandidateScheduledCall_organizationId_status_startsAt_idx"
  ON "CandidateScheduledCall"("organizationId", "status", "startsAt");
CREATE INDEX "CandidateScheduledCall_candidateSessionId_createdAt_idx"
  ON "CandidateScheduledCall"("candidateSessionId", "createdAt");

ALTER TABLE "CandidateScheduledCall"
  ADD CONSTRAINT "CandidateScheduledCall_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateScheduledCall"
  ADD CONSTRAINT "CandidateScheduledCall_candidateSessionId_fkey"
  FOREIGN KEY ("candidateSessionId") REFERENCES "CandidateSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateScheduledCall"
  ADD CONSTRAINT "CandidateScheduledCall_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CandidateScheduledCall"
  ADD CONSTRAINT "CandidateScheduledCall_connectedAccountId_fkey"
  FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
