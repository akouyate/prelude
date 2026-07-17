-- The preflight duplicate lookup is advisory. The unique index is the
-- authoritative concurrent guard: two workers can never both approve the same
-- document hash for one organization. PostgreSQL permits multiple NULL hashes.

DROP INDEX "RoleIntake_organizationId_sha256_idx";

CREATE UNIQUE INDEX "RoleIntake_organizationId_sha256_key"
  ON "RoleIntake"("organizationId", "sha256");
