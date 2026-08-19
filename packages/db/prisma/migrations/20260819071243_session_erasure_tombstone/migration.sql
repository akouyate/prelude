-- AlterTable
ALTER TABLE "CandidateSession" ADD COLUMN     "erasedAt" TIMESTAMP(3),
ADD COLUMN     "erasureReason" TEXT;

-- CreateIndex
CREATE INDEX "CandidateSession_erasedAt_completedAt_idx" ON "CandidateSession"("erasedAt", "completedAt");
