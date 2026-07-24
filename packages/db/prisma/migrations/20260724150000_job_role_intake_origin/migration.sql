-- The database, not only the transaction lock, guarantees one Job per
-- imported RoleIntake.
ALTER TABLE "Job"
  ADD COLUMN "originRoleIntakeId" TEXT;

CREATE UNIQUE INDEX "Job_originRoleIntakeId_key"
  ON "Job"("originRoleIntakeId");
