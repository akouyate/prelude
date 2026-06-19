-- Candidate sessions reference realtime sessions that may be stored by a
-- separate realtime service. Keep the external id, but do not enforce a DB FK.
ALTER TABLE "CandidateSession" DROP CONSTRAINT IF EXISTS "CandidateSession_realtimeSessionId_fkey";
