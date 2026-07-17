-- A duplicate upload is never a second role. Retain only a private pointer to
-- the existing intake so the recruiter can resume it from the console.

ALTER TABLE "RoleIntake"
  ADD COLUMN "duplicateOfIntakeId" TEXT;

CREATE INDEX "RoleIntake_duplicateOfIntakeId_idx"
  ON "RoleIntake"("duplicateOfIntakeId");
