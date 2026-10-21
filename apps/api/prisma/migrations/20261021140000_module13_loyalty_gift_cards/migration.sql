-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 13: loyalty settings, tiers and point entries; reloadable gift cards and their entries.
-- CreateTable
CREATE TABLE "LoyaltySettings" (
    "companyId" UUID NOT NULL,
    "schemeName" TEXT NOT NULL DEFAULT 'Loyalty points',
    "earnSpend" DECIMAL(16,2) NOT NULL DEFAULT 100,
    "earnPoints" INTEGER NOT NULL DEFAULT 1,
    "pointValue" DECIMAL(16,4) NOT NULL DEFAULT 1,
    "validityDays" INTEGER NOT NULL DEFAULT 365,
    "minRedeem" INTEGER NOT NULL DEFAULT 100,
    "maxSharePercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "joinAll" BOOLEAN NOT NULL DEFAULT true,
    "customerGroupIds" UUID[],
    "expiryTo" TEXT NOT NULL DEFAULT 'loyalty_expense',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LoyaltySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "LoyaltyTier" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "spendFrom" DECIMAL(16,2) NOT NULL,
    "earnSpend" DECIMAL(16,2) NOT NULL,
    "earnPoints" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LoyaltyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,
    "billId" UUID,
    "expiresOn" DATE,
    "remaining" INTEGER,
    "sourceEntryId" UUID,
    "entryDate" DATE NOT NULL,
    "storeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "holderName" TEXT,
    "holderPhone" TEXT,
    "customerId" UUID,
    "issuedStoreId" UUID NOT NULL,
    "issuedOn" DATE NOT NULL,
    "loadedTotal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "expiresOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardEntry" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "balanceAfter" DECIMAL(16,2) NOT NULL,
    "billId" UUID,
    "storeId" UUID,
    "entryDate" DATE NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "GiftCardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyTier_companyId_name_key" ON "LoyaltyTier"("companyId", "name");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_customerId_entryDate_idx" ON "LoyaltyEntry"("customerId", "entryDate");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_billId_idx" ON "LoyaltyEntry"("billId");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_companyId_expiresOn_idx" ON "LoyaltyEntry"("companyId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_number_key" ON "GiftCard"("number");

-- CreateIndex
CREATE INDEX "GiftCard_companyId_status_expiresOn_idx" ON "GiftCard"("companyId", "status", "expiresOn");

-- CreateIndex
CREATE INDEX "GiftCardEntry_cardId_createdAt_idx" ON "GiftCardEntry"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardEntry_billId_idx" ON "GiftCardEntry"("billId");

-- AddForeignKey
ALTER TABLE "GiftCardEntry" ADD CONSTRAINT "GiftCardEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

