ALTER TABLE "CandidateSession"
  ADD COLUMN "resumeToken" TEXT,
  ADD COLUMN "consentedAt" TIMESTAMP(3),
  ADD COLUMN "consentCopyVersion" TEXT;

CREATE UNIQUE INDEX "CandidateSession_resumeToken_key"
  ON "CandidateSession"("resumeToken");
