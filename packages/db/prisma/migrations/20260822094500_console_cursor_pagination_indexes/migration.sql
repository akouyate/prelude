-- Cursor-backed console lists are ordered within an organisation. These
-- composite indexes keep the role and candidate page queries index-backed as
-- a workspace accumulates hiring history.
CREATE INDEX "Job_organizationId_createdAt_id_idx"
ON "Job"("organizationId", "createdAt", "id");

CREATE INDEX "CandidateSession_organizationId_updatedAt_id_idx"
ON "CandidateSession"("organizationId", "updatedAt", "id");
