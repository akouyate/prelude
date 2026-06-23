-- CreateTable
CREATE TABLE "live_interview_recordings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "egress_id" TEXT,
    "object_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "layout" TEXT,
    "duration_ms" INTEGER,
    "failed_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_interview_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_interview_recordings_egress_id_key" ON "live_interview_recordings"("egress_id");

-- CreateIndex
CREATE INDEX "live_interview_recordings_session_id_status_idx" ON "live_interview_recordings"("session_id", "status");

-- AddForeignKey
ALTER TABLE "live_interview_recordings" ADD CONSTRAINT "live_interview_recordings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
