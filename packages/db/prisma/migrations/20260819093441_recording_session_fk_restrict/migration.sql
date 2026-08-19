-- A recording row is the only handle on an audio object in Cloudflare R2. Under
-- ON DELETE CASCADE, deleting a live interview session removed that row and left
-- the audio behind, unreachable — orphaned audio the candidate privacy notice
-- promises is "permanently deleted". RESTRICT makes the database refuse instead.
-- Audio is erased only through the realtime service (object first, tombstone
-- second); a deliberate hard-delete must erase audio, verify the tombstones, then
-- remove the recording rows explicitly before the session.

-- DropForeignKey
ALTER TABLE "live_interview_recordings" DROP CONSTRAINT "live_interview_recordings_session_id_fkey";

-- AddForeignKey
ALTER TABLE "live_interview_recordings" ADD CONSTRAINT "live_interview_recordings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "live_interview_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
