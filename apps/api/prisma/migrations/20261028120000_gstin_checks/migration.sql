-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 15 (owner, 28 October 2026): checking a GSTIN with the GST network.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "gstinCancelledOn" DATE,
ADD COLUMN     "gstinCheckedAt" TIMESTAMP(3),
ADD COLUMN     "gstinLegalName" TEXT,
ADD COLUMN     "gstinStatus" TEXT,
ADD COLUMN     "gstinTradeName" TEXT;

-- AlterTable
ALTER TABLE "GstSettings" ADD COLUMN     "gstinChecks" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "gstinRecheckDays" INTEGER NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "gstinCancelledOn" DATE,
ADD COLUMN     "gstinCheckedAt" TIMESTAMP(3),
ADD COLUMN     "gstinLegalName" TEXT,
ADD COLUMN     "gstinStatus" TEXT,
ADD COLUMN     "gstinTradeName" TEXT;

-- CreateTable
CREATE TABLE "GstinCheck" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "gstin" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "facts" JSONB,
    "problem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "GstinCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GstinCheck_companyId_gstin_createdAt_idx" ON "GstinCheck"("companyId", "gstin", "createdAt");

-- CreateIndex
CREATE INDEX "GstinCheck_companyId_createdAt_idx" ON "GstinCheck"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "GstinCheck" ADD CONSTRAINT "GstinCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Plan 14: each shop sees only its own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON "GstinCheck" TO retail_erp_app;
ALTER TABLE "GstinCheck" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstinCheck"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

-- The official HSN list (previous migration) is read by every shop through the app's role.
GRANT SELECT ON "OfficialHsnCode" TO retail_erp_app;
