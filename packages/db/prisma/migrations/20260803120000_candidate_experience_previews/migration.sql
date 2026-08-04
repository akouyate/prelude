CREATE TABLE "CandidateExperiencePreview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "runtimeExpiresAt" TIMESTAMP(3),
    "liveTestCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateExperiencePreview_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "live_interview_sessions"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'candidate',
    ADD COLUMN "expires_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "CandidateExperiencePreview_tokenDigest_key"
    ON "CandidateExperiencePreview"("tokenDigest");
CREATE INDEX "CandidateExperiencePreview_organizationId_createdAt_idx"
    ON "CandidateExperiencePreview"("organizationId", "createdAt");
CREATE INDEX "CandidateExperiencePreview_expiresAt_idx"
    ON "CandidateExperiencePreview"("expiresAt");
CREATE INDEX "CandidateExperiencePreview_runtimeExpiresAt_idx"
    ON "CandidateExperiencePreview"("runtimeExpiresAt");
CREATE INDEX "live_interview_sessions_kind_expires_at_idx"
    ON "live_interview_sessions"("kind", "expires_at");

ALTER TABLE "CandidateExperiencePreview"
    ADD CONSTRAINT "CandidateExperiencePreview_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateExperiencePreview"
    ADD CONSTRAINT "CandidateExperiencePreview_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "InterviewDraft"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CandidateExperiencePreview"
    ADD CONSTRAINT "CandidateExperiencePreview_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
