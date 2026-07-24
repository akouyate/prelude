-- An imported RoleIntake may create exactly one initial InterviewDraft.
-- Later recruiter iterations remain regular drafts and therefore keep this null.
ALTER TABLE "InterviewDraft"
  ADD COLUMN "originRoleIntakeId" TEXT;

CREATE UNIQUE INDEX "InterviewDraft_originRoleIntakeId_key"
  ON "InterviewDraft"("originRoleIntakeId");
