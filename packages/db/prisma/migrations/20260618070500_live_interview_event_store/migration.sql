-- CreateTable
CREATE TABLE "live_interview_sessions" (
    "id" TEXT NOT NULL,
    "interview_plan_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "livekit_room_name" TEXT NOT NULL,
    "allowed_modalities" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_interview_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_interview_events" (
    "event_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "live_interview_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_interview_events_session_id_idempotency_key_key" ON "live_interview_events"("session_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "live_interview_events_session_id_sequence_number_key" ON "live_interview_events"("session_id", "sequence_number");

-- CreateIndex
CREATE INDEX "live_interview_events_session_id_occurred_at_event_id_idx" ON "live_interview_events"("session_id", "occurred_at", "event_id");

-- AddForeignKey
ALTER TABLE "live_interview_events" ADD CONSTRAINT "live_interview_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
