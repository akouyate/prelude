-- AlterTable
ALTER TABLE "live_interview_recordings" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_reason" TEXT,
ALTER COLUMN "object_key" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "live_interview_recordings_status_ended_at_idx" ON "live_interview_recordings"("status", "ended_at");
