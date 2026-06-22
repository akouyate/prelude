-- CreateTable
CREATE TABLE "ComplianceOverrideEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "interviewId" TEXT,
    "overriddenByUserId" TEXT NOT NULL,
    "overriddenByRole" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "classifierProvider" TEXT NOT NULL,
    "classifierModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceOverrideEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceOverrideEvent_organizationId_overriddenByUserId_c_idx" ON "ComplianceOverrideEvent"("organizationId", "overriddenByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceOverrideEvent_organizationId_createdAt_idx" ON "ComplianceOverrideEvent"("organizationId", "createdAt");
