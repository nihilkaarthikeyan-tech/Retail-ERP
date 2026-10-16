-- CreateTable
CREATE TABLE "SummaryEmailSettings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sendAt" TEXT NOT NULL DEFAULT '21:00',
    "recipientIds" UUID[],
    "figures" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "SummaryEmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryEmailRun" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'scheduled',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "recipients" TEXT[],
    "error" TEXT,

    CONSTRAINT "SummaryEmailRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SummaryEmailSettings_companyId_key" ON "SummaryEmailSettings"("companyId");

-- CreateIndex
CREATE INDEX "SummaryEmailRun_companyId_startedAt_idx" ON "SummaryEmailRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_documentLineId_idx" ON "StockLedgerEntry"("documentLineId");

-- The scheduled summary email is sent at most once per company per business date (plan 09 scenario 9.10).
CREATE UNIQUE INDEX "SummaryEmailRun_once_per_day" ON "SummaryEmailRun" ("companyId", "businessDate") WHERE "kind" = 'scheduled';

-- Permission key for the Owner (plan 09 section 8).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", 'reports.summary_email' FROM "Role" r WHERE r."code" = 'owner_admin'
ON CONFLICT DO NOTHING;
