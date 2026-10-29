-- Copyright (c) 2026, Rademics. All rights reserved.
-- Audit 7 (data safety), 29 October 2026: the database itself backs up the rules the code keeps.

-- 1. Links Prisma knows about: special prices block deleting their customer or supplier; the stock
--    ledger and stock totals point at a real item and place; an opening bill is entered once.
-- DropForeignKey
ALTER TABLE "Price" DROP CONSTRAINT "Price_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Price" DROP CONSTRAINT "Price_supplierId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBill_companyId_partyType_partyId_billNumber_key" ON "OpeningBill"("companyId", "partyType", "partyId", "billNumber");

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedgerEntry" ADD CONSTRAINT "StockLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockPosition" ADD CONSTRAINT "StockPosition_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 2. A saved document (anything past draft) cannot be deleted: its lines would go with it (ON DELETE
--    CASCADE) while its ledger and stock entries stayed. Mistakes are cancelled instead (rule 4.4).
--    Clearing trial data (decision 72) is the one exception, inside its own transaction.
CREATE OR REPLACE FUNCTION posted_document_guard() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.clear_trial', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_ARGV[0] = 'always' OR OLD."status"::text <> 'draft' THEN
    RAISE EXCEPTION '% rows that are saved cannot be deleted; cancel them instead', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosBill_no_delete" BEFORE DELETE ON "PosBill" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('always');
CREATE TRIGGER "ShiftClosing_no_delete" BEFORE DELETE ON "ShiftClosing" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('always');
CREATE TRIGGER "SupplierBill_no_delete" BEFORE DELETE ON "SupplierBill" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "GoodsReceipt_no_delete" BEFORE DELETE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "StockDocument_no_delete" BEFORE DELETE ON "StockDocument" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "PurchaseOrder_no_delete" BEFORE DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "Journal_no_delete" BEFORE DELETE ON "Journal" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "Payment_no_delete" BEFORE DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "OpeningBill_no_delete" BEFORE DELETE ON "OpeningBill" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');
CREATE TRIGGER "YearEndClosing_no_delete" BEFORE DELETE ON "YearEndClosing" FOR EACH ROW EXECUTE FUNCTION posted_document_guard('draft');

-- 3. History of money owed to card holders, till cash and drawer openings is written once and kept.
CREATE OR REPLACE FUNCTION history_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.clear_trial', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are history and cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GiftCardEntry_history" BEFORE UPDATE OR DELETE ON "GiftCardEntry" FOR EACH ROW EXECUTE FUNCTION history_guard();
CREATE TRIGGER "CashMovement_history" BEFORE UPDATE OR DELETE ON "CashMovement" FOR EACH ROW EXECUTE FUNCTION history_guard();
CREATE TRIGGER "PosDrawerOpening_history" BEFORE UPDATE OR DELETE ON "PosDrawerOpening" FOR EACH ROW EXECUTE FUNCTION history_guard();
-- Points entries keep a "remaining" count that spending lowers, so only deleting is refused.
CREATE TRIGGER "LoyaltyEntry_no_delete" BEFORE DELETE ON "LoyaltyEntry" FOR EACH ROW EXECUTE FUNCTION history_guard();

-- 4. Re-costing may change only the figures it works out, never what the movement was.
CREATE OR REPLACE FUNCTION stock_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('app.clear_trial', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'StockLedgerEntry rows cannot be deleted';
  END IF;
  IF coalesce(current_setting('app.stock_recost', true), '') <> 'on' THEN
    RAISE EXCEPTION 'StockLedgerEntry rows cannot be changed except by re-costing';
  END IF;
  IF NEW."itemId" <> OLD."itemId" OR NEW."locationId" <> OLD."locationId" OR NEW."documentId" <> OLD."documentId"
     OR NEW."postingAt" <> OLD."postingAt" OR NEW."kind" <> OLD."kind" OR NEW."intentQuantity" <> OLD."intentQuantity"
     OR NEW."companyId" <> OLD."companyId" OR NEW."postingDate" <> OLD."postingDate" OR NEW."documentType" <> OLD."documentType"
     OR NEW."documentLineId" IS DISTINCT FROM OLD."documentLineId" OR NEW."batchId" IS DISTINCT FROM OLD."batchId"
     OR NEW."reversesId" IS DISTINCT FROM OLD."reversesId" OR NEW."isCancellation" IS DISTINCT FROM OLD."isCancellation"
     OR NEW."accountRole" IS DISTINCT FROM OLD."accountRole" THEN
    RAISE EXCEPTION 'Re-costing may only change derived figures';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Values that can never be out of range.
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_balance_not_negative" CHECK ("balance" >= 0);
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_factor_positive" CHECK ("factor" > 0);
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_factor_positive" CHECK ("factor" > 0);
ALTER TABLE "GstRate" ADD CONSTRAINT "GstRate_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_remaining_not_negative" CHECK ("remaining" IS NULL OR "remaining" >= 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_used_not_negative" CHECK ("usedCount" >= 0);
