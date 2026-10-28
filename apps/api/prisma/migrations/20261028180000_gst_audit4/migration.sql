-- Copyright (c) 2026, Rademics. All rights reserved.
-- GST audit 4 (owner decisions T2, T6, T9, T10, T15; 28 October 2026).
ALTER TABLE "GstSettings" ADD COLUMN "sezUnderLut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PosBill" ADD COLUMN "documentKind" TEXT;
ALTER TABLE "PosBill" ADD COLUMN "gstPeriod" TEXT;
ALTER TABLE "PosDelivery" ADD COLUMN "forOther" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GstFiledPeriod" (
  "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
  "id" UUID NOT NULL,
  "gstRegistrationId" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "returnType" TEXT NOT NULL,
  "filedOn" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" UUID,
  CONSTRAINT "GstFiledPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GstFiledPeriod_gstRegistrationId_period_returnType_key" ON "GstFiledPeriod"("gstRegistrationId", "period", "returnType");
CREATE INDEX "GstFiledPeriod_companyId_idx" ON "GstFiledPeriod"("companyId");

-- Plan 14: each shop sees only its own rows (row-level security), as every business table.
ALTER TABLE "GstFiledPeriod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstFiledPeriod"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "GstFiledPeriod" TO retail_erp_app;
