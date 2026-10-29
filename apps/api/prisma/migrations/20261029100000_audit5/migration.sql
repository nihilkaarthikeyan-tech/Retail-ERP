-- Copyright (c) 2026, Rademics. All rights reserved.
-- Audit 5 (billing counter; owner decisions C1–C9, 29 October 2026).

-- The figure a manager approved (cash difference, cash out, bill discount), compared when it is used.
ALTER TABLE "PosApproval" ADD COLUMN "approvedAmount" DECIMAL(16,2),
ADD COLUMN "approvedPercent" DECIMAL(5,2);

-- The same bill identity sent with other content is refused instead of answered with the first bill.
ALTER TABLE "PosBill" ADD COLUMN "clientHash" TEXT;

-- "Offline bills to check": what the server's price list, offer, rate and limits said for a flagged line.
ALTER TABLE "PosBillLine" ADD COLUMN "serverFigures" JSONB;

-- C5: cash out above this needs a manager; C8: blind count at closing.
ALTER TABLE "PosSettings" ADD COLUMN "blindCount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cashOutApprovalAbove" DECIMAL(16,2) NOT NULL DEFAULT 2000;

-- C3: who sent a bill the server could not save (its cashier when the office posts it into a shift).
ALTER TABLE "PosSyncProblem" ADD COLUMN "sentById" UUID;

-- C4: every opening of a till's cash drawer.
CREATE TABLE "PosDrawerOpening" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "tillId" UUID NOT NULL,
    "shiftId" UUID,
    "clientId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "billClientId" UUID,
    "approvedById" UUID,
    "byId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDrawerOpening_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosDrawerOpening_shiftId_idx" ON "PosDrawerOpening"("shiftId");
CREATE INDEX "PosDrawerOpening_companyId_idx" ON "PosDrawerOpening"("companyId");
CREATE UNIQUE INDEX "PosDrawerOpening_tillId_clientId_key" ON "PosDrawerOpening"("tillId", "clientId");

-- Plan 14: each shop sees only its own rows (row-level security), as every business table.
ALTER TABLE "PosDrawerOpening" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosDrawerOpening"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON "PosDrawerOpening" TO retail_erp_app;

-- One open shift per till, kept by the database (two openings at the same moment cannot both win).
CREATE UNIQUE INDEX "Shift_one_open_per_till" ON "Shift"("tillId") WHERE ("status" = 'open');
