ALTER TABLE "MarketingDemoControl"
    ADD COLUMN "dailyLeadCap" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "MarketingDemoDailyUsage"
    ADD COLUMN "leadCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "MarketingDemoLeadCapture" (
    "id" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingDemoLeadCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingDemoLeadCapture_tokenDigest_key"
    ON "MarketingDemoLeadCapture"("tokenDigest");
CREATE INDEX "MarketingDemoLeadCapture_expiresAt_idx"
    ON "MarketingDemoLeadCapture"("expiresAt");

ALTER TABLE "MarketingDemoLead"
    ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "lastSubmittedAt" TIMESTAMP(3),
    ADD COLUMN "withdrawnAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "MarketingDemoLead"
SET
    "email" = LOWER(TRIM("email")),
    "marketingConsent" = true,
    "lastSubmittedAt" = "consentedAt",
    "updatedAt" = "createdAt";

DELETE FROM "MarketingDemoLead" older
USING "MarketingDemoLead" newer
WHERE older."email" = newer."email"
  AND (
    older."consentedAt" < newer."consentedAt"
    OR (
      older."consentedAt" = newer."consentedAt"
      AND older."id" < newer."id"
    )
  );

ALTER TABLE "MarketingDemoLead"
    ALTER COLUMN "consentVersion" DROP NOT NULL,
    ALTER COLUMN "consentedAt" DROP NOT NULL,
    ALTER COLUMN "lastSubmittedAt" SET NOT NULL,
    ALTER COLUMN "updatedAt" SET NOT NULL;

DROP INDEX IF EXISTS "MarketingDemoLead_createdAt_idx";
CREATE UNIQUE INDEX "MarketingDemoLead_email_key"
    ON "MarketingDemoLead"("email");
CREATE INDEX "MarketingDemoLead_consentedAt_idx"
    ON "MarketingDemoLead"("consentedAt");
CREATE INDEX "MarketingDemoLead_withdrawnAt_idx"
    ON "MarketingDemoLead"("withdrawnAt");

CREATE TABLE "MarketingDemoLeadOutbox" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingLeaseExpiresAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingDemoLeadOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingDemoLeadOutbox_status_nextAttemptAt_idx"
    ON "MarketingDemoLeadOutbox"("status", "nextAttemptAt");
CREATE INDEX "MarketingDemoLeadOutbox_processingLeaseExpiresAt_idx"
    ON "MarketingDemoLeadOutbox"("processingLeaseExpiresAt");
ALTER TABLE "MarketingDemoLeadOutbox"
    ADD CONSTRAINT "MarketingDemoLeadOutbox_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "MarketingDemoLead"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
