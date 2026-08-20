ALTER TABLE "CandidateExperiencePreview"
    ADD COLUMN "startedAt" TIMESTAMP(3),
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "realtimeSessionId" TEXT;

CREATE UNIQUE INDEX "CandidateExperiencePreview_realtimeSessionId_key"
    ON "CandidateExperiencePreview"("realtimeSessionId");

CREATE TABLE "MarketingDemoRole" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "publicTitle" TEXT NOT NULL,
    "publicSummary" TEXT NOT NULL,
    "publicBadge" TEXT,
    "locale" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "draftId" TEXT NOT NULL,
    "postInterviewQuestions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingDemoRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingDemoRole_slug_key" ON "MarketingDemoRole"("slug");
CREATE INDEX "MarketingDemoRole_enabled_displayOrder_idx"
    ON "MarketingDemoRole"("enabled", "displayOrder");
ALTER TABLE "MarketingDemoRole"
    ADD CONSTRAINT "MarketingDemoRole_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "InterviewDraft"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MarketingDemoControl" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyStartedSessionCap" INTEGER NOT NULL,
    "concurrentSessionCap" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingDemoControl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingDemoDailyUsage" (
    "day" DATE NOT NULL,
    "startedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingDemoDailyUsage_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "MarketingDemoLaunch" (
    "id" TEXT NOT NULL,
    "nonceDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingDemoLaunch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingDemoLaunch_nonceDigest_key"
    ON "MarketingDemoLaunch"("nonceDigest");
CREATE INDEX "MarketingDemoLaunch_expiresAt_idx"
    ON "MarketingDemoLaunch"("expiresAt");

CREATE TABLE "MarketingDemoHandoff" (
    "id" TEXT NOT NULL,
    "codeDigest" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "returnTarget" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingDemoHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingDemoHandoff_codeDigest_key"
    ON "MarketingDemoHandoff"("codeDigest");
CREATE UNIQUE INDEX "MarketingDemoHandoff_previewId_key"
    ON "MarketingDemoHandoff"("previewId");
CREATE INDEX "MarketingDemoHandoff_expiresAt_idx"
    ON "MarketingDemoHandoff"("expiresAt");
ALTER TABLE "MarketingDemoHandoff"
    ADD CONSTRAINT "MarketingDemoHandoff_previewId_fkey"
    FOREIGN KEY ("previewId") REFERENCES "CandidateExperiencePreview"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketingDemoLead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingDemoLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingDemoLead_createdAt_idx"
    ON "MarketingDemoLead"("createdAt");
