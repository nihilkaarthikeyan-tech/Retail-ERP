-- Copyright (c) 2026, Rademics. All rights reserved.
-- Audit 8 (speed and growth), 29 October 2026: indexes for the lists, look-ups and reports that
-- read whole tables at the size of a busy shop (500,000 bills), and fast "contains" search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "AuditLog_companyId_at_idx" ON "AuditLog"("companyId", "at");

-- CreateIndex
CREATE INDEX "Barcode_itemId_idx" ON "Barcode"("itemId");

-- CreateIndex
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Customer_mobile_trgm_idx" ON "Customer" USING GIN ("mobile" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_itemId_idx" ON "GoodsReceiptLine"("itemId");

-- CreateIndex
CREATE INDEX "Item_name_trgm_idx" ON "Item" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Item_code_trgm_idx" ON "Item" USING GIN ("code" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "LedgerLine_entryId_idx" ON "LedgerLine"("entryId");

-- CreateIndex
CREATE INDEX "PosBill_companyId_soldAt_idx" ON "PosBill"("companyId", "soldAt" DESC);

-- CreateIndex
CREATE INDEX "PosBill_returnOfId_idx" ON "PosBill"("returnOfId");

-- CreateIndex
CREATE INDEX "PosBill_customerId_businessDate_idx" ON "PosBill"("customerId", "businessDate");

-- CreateIndex
CREATE INDEX "PosBill_companyId_gstPeriod_idx" ON "PosBill"("companyId", "gstPeriod");

-- CreateIndex
CREATE INDEX "PosBill_tillId_number_idx" ON "PosBill"("tillId", "number");

-- CreateIndex
CREATE INDEX "PosBill_number_trgm_idx" ON "PosBill" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "PosPayment_billId_idx" ON "PosPayment"("billId");

-- CreateIndex
CREATE INDEX "PosPayment_paymentMethodId_idx" ON "PosPayment"("paymentMethodId");

-- CreateIndex
CREATE INDEX "StockDocumentLine_itemId_idx" ON "StockDocumentLine"("itemId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_unposted_idx" ON "StockLedgerEntry"("companyId") WHERE ("ledgerHeld" = false AND "valueChange" <> "postedValue");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_locationId_postingAt_id_idx" ON "StockLedgerEntry"("locationId", "postingAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "StockLedgerEntry_locationId_postingDate_idx" ON "StockLedgerEntry"("locationId", "postingDate");


-- Emails sent per day, against the mailbox allowance (system table: closed to the shop role).
CREATE TABLE "MailDay" (
    "day" DATE NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MailDay_pkey" PRIMARY KEY ("day")
);
ALTER TABLE "MailDay" ENABLE ROW LEVEL SECURITY;
