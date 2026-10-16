-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 11 part 2: customer orders, stock set aside, alteration jobs, sale-or-return statements, Tally ledger map.
-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "isConsignment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN     "alterationItemId" UUID;

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expectedOn" DATE,
    "remarks" TEXT,
    "readyAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "collectedBillId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "advanceOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "price" DECIMAL(16,4) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "CustomerOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "orderLineId" UUID NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlterationJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" UUID,
    "name" TEXT,
    "phone" TEXT,
    "billId" UUID,
    "tailorStaffId" UUID,
    "tailorName" TEXT,
    "promisedOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "charge" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "chargePaidWith" TEXT NOT NULL DEFAULT 'collection',
    "chargeBillId" UUID,
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "deliveredAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "AlterationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlterationJobLine" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID,
    "garment" TEXT NOT NULL,
    "work" TEXT NOT NULL,

    CONSTRAINT "AlterationJobLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentStatement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "supplierBillId" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ConsignmentStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentStatementLine" (
    "id" UUID NOT NULL,
    "statementId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "received" DECIMAL(18,3) NOT NULL,
    "sold" DECIMAL(18,3) NOT NULL,
    "returned" DECIMAL(18,3) NOT NULL,
    "held" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(16,4) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "ConsignmentStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyLedgerMap" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "tallyLedger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "TallyLedgerMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_number_key" ON "CustomerOrder"("number");

-- CreateIndex
CREATE INDEX "CustomerOrder_storeId_status_idx" ON "CustomerOrder"("storeId", "status");

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_idx" ON "CustomerOrder"("customerId");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_orderId_idx" ON "CustomerOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "StockReservation_itemId_locationId_idx" ON "StockReservation"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "StockReservation_orderLineId_idx" ON "StockReservation"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "AlterationJob_number_key" ON "AlterationJob"("number");

-- CreateIndex
CREATE INDEX "AlterationJob_storeId_status_promisedOn_idx" ON "AlterationJob"("storeId", "status", "promisedOn");

-- CreateIndex
CREATE INDEX "AlterationJobLine_jobId_idx" ON "AlterationJobLine"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentStatement_number_key" ON "ConsignmentStatement"("number");

-- CreateIndex
CREATE INDEX "ConsignmentStatement_supplierId_storeId_idx" ON "ConsignmentStatement"("supplierId", "storeId");

-- CreateIndex
CREATE INDEX "ConsignmentStatementLine_statementId_idx" ON "ConsignmentStatementLine"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "TallyLedgerMap_accountId_key" ON "TallyLedgerMap"("accountId");

-- AddForeignKey
ALTER TABLE "CustomerOrderLine" ADD CONSTRAINT "CustomerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlterationJobLine" ADD CONSTRAINT "AlterationJobLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AlterationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentStatementLine" ADD CONSTRAINT "ConsignmentStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ConsignmentStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
