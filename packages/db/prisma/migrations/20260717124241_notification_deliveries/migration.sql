-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateSessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAttempt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_dedupeKey_key" ON "NotificationDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_organizationId_status_updatedAt_idx" ON "NotificationDelivery"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_candidateSessionId_eventType_idx" ON "NotificationDelivery"("candidateSessionId", "eventType");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recipientEmail_createdAt_idx" ON "NotificationDelivery"("recipientEmail", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationAttempt_status_createdAt_idx" ON "NotificationAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAttempt_notificationId_attemptNumber_key" ON "NotificationAttempt"("notificationId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_candidateSessionId_fkey" FOREIGN KEY ("candidateSessionId") REFERENCES "CandidateSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAttempt" ADD CONSTRAINT "NotificationAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CandidateScheduledCall_connectedAccountId_providerCalendarId_pr" RENAME TO "CandidateScheduledCall_connectedAccountId_providerCalendarI_key";
