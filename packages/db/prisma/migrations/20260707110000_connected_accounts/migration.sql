CREATE TABLE "ConnectedAccount" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "capabilities" JSONB NOT NULL DEFAULT '[]',
  "scopes" JSONB NOT NULL DEFAULT '[]',
  "externalAccountId" TEXT,
  "externalAccountEmail" TEXT,
  "accessTokenCiphertext" TEXT,
  "refreshTokenCiphertext" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3),
  "lastRefreshAttemptAt" TIMESTAMP(3),
  "lastRefreshError" TEXT,
  "connectedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectedAccount_organizationId_userId_provider_key"
  ON "ConnectedAccount"("organizationId", "userId", "provider");

CREATE INDEX "ConnectedAccount_organizationId_provider_status_idx"
  ON "ConnectedAccount"("organizationId", "provider", "status");

CREATE INDEX "ConnectedAccount_userId_provider_idx"
  ON "ConnectedAccount"("userId", "provider");

ALTER TABLE "ConnectedAccount"
  ADD CONSTRAINT "ConnectedAccount_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConnectedAccount"
  ADD CONSTRAINT "ConnectedAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
