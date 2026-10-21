-- Copyright (c) 2026, Rademics. All rights reserved.
-- Module 8 (GST, plan 08): rates by price band and kind, tax situations, invoice kinds, reverse charge, settings, e-invoices, e-way bills, return uploads.
-- DropIndex
DROP INDEX "GstRate_hsnCode_effectiveFrom_key";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "taxSituation" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "taxSituation" TEXT;

-- AlterTable
ALTER TABLE "GstRate" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'taxable',
ADD COLUMN     "priceFrom" DECIMAL(16,2),
ADD COLUMN     "priceUpTo" DECIMAL(16,2);

-- AlterTable
ALTER TABLE "PosBill" ADD COLUMN     "buyerAddress" TEXT,
ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerName" TEXT,
ADD COLUMN     "buyerStateCode" TEXT,
ADD COLUMN     "gstRegistrationId" UUID,
ADD COLUMN     "invoiceKind" TEXT NOT NULL DEFAULT 'consumer',
ADD COLUMN     "placeOfSupply" TEXT;

-- AlterTable
ALTER TABLE "PosBillLine" ADD COLUMN     "hsnCode" TEXT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "taxSituation" TEXT;

-- AlterTable
ALTER TABLE "SupplierBill" ADD COLUMN     "gstRegistrationId" UUID,
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "reverseCharge" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupplierBillLine" ADD COLUMN     "creditClaimable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hsnCode" TEXT;

-- CreateTable
CREATE TABLE "GstSettings" (
    "companyId" UUID NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'regular',
    "filingFrequency" TEXT NOT NULL DEFAULT 'quarterly',
    "turnoverBand" TEXT NOT NULL DEFAULT 'up_to_5cr',
    "hsnDigits" INTEGER NOT NULL DEFAULT 4,
    "eInvoiceApplies" BOOLEAN NOT NULL DEFAULT false,
    "combineSmallSales" BOOLEAN NOT NULL DEFAULT true,
    "freeSampleTax" TEXT NOT NULL DEFAULT 'not_set',
    "receiptTaxTable" BOOLEAN NOT NULL DEFAULT true,
    "eWayLimit" DECIMAL(16,2) NOT NULL DEFAULT 50000,
    "eWayStateLimits" JSONB NOT NULL DEFAULT '{}',
    "defaultTransporterId" TEXT,
    "defaultTransporterName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "approvalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "GstSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "EInvoice" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "gstRegistrationId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "irn" TEXT,
    "ackNumber" TEXT,
    "ackDate" TIMESTAMP(3),
    "signedQr" TEXT,
    "error" TEXT,
    "exportedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EWayBill" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,
    "distanceKm" INTEGER,
    "transporterId" TEXT,
    "transporterName" TEXT,
    "vehicleNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "number" TEXT,
    "generatedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "EWayBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GstReturnUpload" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "gstRegistrationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "GstReturnUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EInvoice_companyId_status_idx" ON "EInvoice"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EInvoice_documentType_documentId_key" ON "EInvoice"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "EWayBill_companyId_status_idx" ON "EWayBill"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EWayBill_documentType_documentId_key" ON "EWayBill"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "GstReturnUpload_gstRegistrationId_kind_period_idx" ON "GstReturnUpload"("gstRegistrationId", "kind", "period");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_hsnCode_effectiveFrom_priceFrom_key" ON "GstRate"("hsnCode", "effectiveFrom", "priceFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_hsn_date_no_band_key" ON "GstRate"("hsnCode", "effectiveFrom") WHERE ("priceFrom" IS NULL);

