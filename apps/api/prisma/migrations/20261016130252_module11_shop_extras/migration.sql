-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 11 part 1: salesperson, seasons, markdowns, home delivery, new offer kinds, birthdays.
-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "anniversary" TEXT,
ADD COLUMN     "anniversaryYear" INTEGER,
ADD COLUMN     "birthYear" INTEGER,
ADD COLUMN     "birthday" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "seasonId" UUID;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "cheapestFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeItemId" UUID,
ADD COLUMN     "setPrice" DECIMAL(16,2),
ADD COLUMN     "setQuantity" INTEGER;

-- AlterTable
ALTER TABLE "PosBill" ADD COLUMN     "salesStaffId" UUID;

-- AlterTable
ALTER TABLE "PosBillLine" ADD COLUMN     "salesStaffId" UUID;

-- AlterTable
ALTER TABLE "PosSettings" ADD COLUMN     "deliveryItemId" UUID;

-- AlterTable
ALTER TABLE "Price" ADD COLUMN     "markdownId" UUID;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "deliveryCharge" DECIMAL(16,2) NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryFreeAbove" DECIMAL(16,2);

-- CreateTable
CREATE TABLE "SalesStaff" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "SalesStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Markdown" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "rule" TEXT NOT NULL,
    "value" DECIMAL(16,4) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "chosenBy" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Markdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosDelivery" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "customerId" UUID,
    "name" TEXT,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "deliverOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chargeAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "deliveredById" UUID,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PosDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesStaff_companyId_idx" ON "SalesStaff"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesStaff_storeId_code_key" ON "SalesStaff"("storeId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Season_companyId_code_key" ON "Season"("companyId", "code");

-- CreateIndex
CREATE INDEX "Markdown_companyId_startDate_idx" ON "Markdown"("companyId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PosDelivery_billId_key" ON "PosDelivery"("billId");

-- CreateIndex
CREATE INDEX "PosDelivery_storeId_status_idx" ON "PosDelivery"("storeId", "status");

-- CreateIndex
CREATE INDEX "Item_seasonId_idx" ON "Item"("seasonId");
