-- Credit billing (issue #140, phase 1). The ledger is append-only and is the
-- source of truth; the wallet row caches totals and is the FOR UPDATE lock
-- target that serialises credit operations per organization. Rows here must
-- survive product-row deletion, so nothing cascades from CandidateSession and
-- organizations with billing history cannot be hard-deleted (Restrict).

-- CreateTable
CREATE TABLE "CreditWallet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "availableCredits" INTEGER NOT NULL DEFAULT 0,
    "reservedCredits" INTEGER NOT NULL DEFAULT 0,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "packId" TEXT,
    "creditsGranted" INTEGER NOT NULL,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "creditsReserved" INTEGER NOT NULL DEFAULT 0,
    "unitAmountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'active',
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "candidateSessionId" TEXT,
    "stripeEventId" TEXT,
    "actorKind" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateSessionId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "heldAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_organizationId_key" ON "CreditWallet"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditWallet_stripeCustomerId_key" ON "CreditWallet"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "CreditLot_organizationId_status_expiresAt_idx" ON "CreditLot"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLot_stripePaymentIntentId_key" ON "CreditLot"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLot_stripeCheckoutSessionId_key" ON "CreditLot"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLot_stripeInvoiceId_key" ON "CreditLot"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_organizationId_createdAt_idx" ON "CreditLedgerEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditReservation_organizationId_status_expiresAt_idx" ON "CreditReservation"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_candidateSessionId_key" ON "CreditReservation"("candidateSessionId");

-- AddForeignKey
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLot" ADD CONSTRAINT "CreditLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "CreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "CreditLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
