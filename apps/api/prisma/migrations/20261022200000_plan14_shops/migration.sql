-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 14: one system for many shops. Every business table records its shop
-- ("companyId"), codes and document numbers are unique per shop, and the
-- database itself shows each shop only its own rows (row-level security).

-- Existing rows belong to the existing shop: the new columns take their value
-- from this setting while they are added. A database with no shop yet holds no
-- business data, only defaults made at start-up; those are cleared and made
-- again per shop.
DO $$
DECLARE first_company uuid;
BEGIN
  SELECT id INTO first_company FROM "Company" ORDER BY "createdAt" LIMIT 1;
  IF first_company IS NULL THEN
    TRUNCATE TABLE "GstRegistration", "Store", "FinancialYear", "NumberSeries", "NumberSeriesCounter", "User", "Role", "RolePermission", "UserRole", "UserStore", "Session", "SecuritySettings", "AuditLog", "Unit", "UnitConversion", "ItemGroup", "Brand", "HsnCode", "VariantAttribute", "VariantAttributeValue", "Item", "ItemUnit", "Barcode", "ItemVariantAttribute", "ItemVariantValue", "PriceList", "Price", "CatalogueSettings", "Address", "ContactPerson", "PaymentTerms", "PaymentTermsPart", "CustomerGroup", "Customer", "SupplierGroup", "Supplier", "PartySettings", "StockLocation", "StockDocument", "StockDocumentLine", "StockLedgerEntry", "StockPosition", "Batch", "BatchPosition", "SerialNumber", "ReorderLevel", "InventorySettings", "PurchaseOrder", "PurchaseOrderLine", "GoodsReceipt", "GoodsReceiptLine", "SupplierBill", "SupplierBillLine", "LandedCharge", "LandedChargeItem", "LandedChargeShare", "ReorderSuggestion", "PurchaseSettings", "GstRate", "PaymentMethod", "Till", "TillPaymentMethod", "TillDevice", "UserPin", "Shift", "ShiftCash", "CashMovement", "ShiftClosing", "ShiftClosingLine", "PosBill", "PosBillLine", "PosPayment", "Offer", "Coupon", "PosSettings", "PosApproval", "PosCashierToken", "PosSyncProblem", "Account", "AccountDefault", "AccountingSettings", "LedgerEntry", "LedgerLine", "Settlement", "Journal", "JournalLine", "Payment", "PaymentAllocation", "PaymentDeduction", "OpeningBill", "BankAccount", "YearEndClosing", "SummaryEmailSettings", "SummaryEmailRun", "PrintSettings", "StandardTerms", "LabelTemplate", "ImportJob", "ImportRow", "TrialClearing", "SalesStaff", "Season", "Markdown", "PosDelivery", "CustomerOrder", "CustomerOrderLine", "StockReservation", "AlterationJob", "AlterationJobLine", "ConsignmentStatement", "ConsignmentStatementLine", "TallyLedgerMap", "GstSettings", "EInvoice", "EWayBill", "GstReturnUpload", "CompanyModule", "SetupProgress", "LoyaltySettings", "LoyaltyTier", "LoyaltyEntry", "GiftCard", "GiftCardEntry" CASCADE;
  ELSE
    PERFORM set_config('app.company_id', first_company::text, false);
  END IF;
END $$;

-- DropIndex
DROP INDEX "AlterationJob_number_key";

-- DropIndex
DROP INDEX "Barcode_code_key";

-- DropIndex
DROP INDEX "Brand_code_key";

-- DropIndex
DROP INDEX "ConsignmentStatement_number_key";

-- DropIndex
DROP INDEX "Customer_code_key";

-- DropIndex
DROP INDEX "CustomerGroup_code_key";

-- DropIndex
DROP INDEX "CustomerOrder_number_key";

-- DropIndex
DROP INDEX "GiftCard_number_key";

-- DropIndex
DROP INDEX "GoodsReceipt_number_key";

-- DropIndex
DROP INDEX "GstRate_hsnCode_effectiveFrom_priceFrom_key";

-- DropIndex
DROP INDEX "GstRate_hsn_date_no_band_key";

-- DropIndex
DROP INDEX "GstRegistration_gstin_key";

-- DropIndex
DROP INDEX "HsnCode_code_key";

-- DropIndex
DROP INDEX "Item_code_key";

-- DropIndex
DROP INDEX "ItemGroup_code_key";

-- DropIndex
DROP INDEX "LandedCharge_number_key";

-- DropIndex
DROP INDEX "PaymentTerms_code_key";

-- DropIndex
DROP INDEX "PosBill_number_key";

-- DropIndex
DROP INDEX "PurchaseOrder_number_key";

-- DropIndex
DROP INDEX "Role_code_key";

-- DropIndex
DROP INDEX "StockDocument_number_key";

-- DropIndex
DROP INDEX "Supplier_code_key";

-- DropIndex
DROP INDEX "SupplierBill_number_key";

-- DropIndex
DROP INDEX "SupplierGroup_code_key";

-- DropIndex
DROP INDEX "Unit_code_key";

-- DropIndex
DROP INDEX "VariantAttribute_code_key";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "AlterationJobLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Barcode" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "BatchPosition" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ConsignmentStatementLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ContactPerson" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "CustomerGroup" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "CustomerOrderLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "GiftCardEntry" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "GoodsReceiptLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "GstRate" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "HsnCode" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ItemGroup" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ItemUnit" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ItemVariantAttribute" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ItemVariantValue" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "LandedChargeItem" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "LandedChargeShare" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "NumberSeriesCounter" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PaymentDeduction" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PaymentTerms" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PaymentTermsPart" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PosApproval" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PosBillLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PosCashierToken" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PosPayment" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Price" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ReorderLevel" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "SecuritySettings" DROP CONSTRAINT "SecuritySettings_pkey",
DROP COLUMN "id",
ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid,
ADD CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("companyId");

-- AlterTable
ALTER TABLE "SerialNumber" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "SetupProgress" DROP CONSTRAINT "SetupProgress_pkey",
DROP COLUMN "id",
ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid,
ADD CONSTRAINT "SetupProgress_pkey" PRIMARY KEY ("companyId");

-- AlterTable
ALTER TABLE "ShiftCash" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ShiftClosing" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "ShiftClosingLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "StockDocumentLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "SupplierBillLine" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "SupplierGroup" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "TillDevice" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "TillPaymentMethod" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "UnitConversion" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "UserPin" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "UserRole" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "UserStore" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "VariantAttribute" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- AlterTable
ALTER TABLE "VariantAttributeValue" ADD COLUMN     "companyId" UUID NOT NULL DEFAULT (nullif(current_setting('app.company_id', true), ''))::uuid;

-- CreateIndex
CREATE INDEX "Address_companyId_idx" ON "Address"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AlterationJob_companyId_number_key" ON "AlterationJob"("companyId", "number");

-- CreateIndex
CREATE INDEX "AlterationJobLine_companyId_idx" ON "AlterationJobLine"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "Barcode_companyId_idx" ON "Barcode"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Barcode_companyId_code_key" ON "Barcode"("companyId", "code");

-- CreateIndex
CREATE INDEX "Batch_companyId_idx" ON "Batch"("companyId");

-- CreateIndex
CREATE INDEX "BatchPosition_companyId_idx" ON "BatchPosition"("companyId");

-- CreateIndex
CREATE INDEX "Brand_companyId_idx" ON "Brand"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_companyId_code_key" ON "Brand"("companyId", "code");

-- CreateIndex
CREATE INDEX "CashMovement_companyId_idx" ON "CashMovement"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentStatement_companyId_number_key" ON "ConsignmentStatement"("companyId", "number");

-- CreateIndex
CREATE INDEX "ConsignmentStatementLine_companyId_idx" ON "ConsignmentStatementLine"("companyId");

-- CreateIndex
CREATE INDEX "ContactPerson_companyId_idx" ON "ContactPerson"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_code_key" ON "Customer"("companyId", "code");

-- CreateIndex
CREATE INDEX "CustomerGroup_companyId_idx" ON "CustomerGroup"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_companyId_code_key" ON "CustomerGroup"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_companyId_number_key" ON "CustomerOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_companyId_idx" ON "CustomerOrderLine"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_companyId_number_key" ON "GiftCard"("companyId", "number");

-- CreateIndex
CREATE INDEX "GiftCardEntry_companyId_idx" ON "GiftCardEntry"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_companyId_number_key" ON "GoodsReceipt"("companyId", "number");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_companyId_idx" ON "GoodsReceiptLine"("companyId");

-- CreateIndex
CREATE INDEX "GstRate_companyId_idx" ON "GstRate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_companyId_hsnCode_effectiveFrom_priceFrom_key" ON "GstRate"("companyId", "hsnCode", "effectiveFrom", "priceFrom");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_hsn_date_no_band_key" ON "GstRate"("companyId", "hsnCode", "effectiveFrom") WHERE ("priceFrom" IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "GstRegistration_companyId_gstin_key" ON "GstRegistration"("companyId", "gstin");

-- CreateIndex
CREATE INDEX "HsnCode_companyId_idx" ON "HsnCode"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_companyId_code_key" ON "HsnCode"("companyId", "code");

-- CreateIndex
CREATE INDEX "ImportRow_companyId_idx" ON "ImportRow"("companyId");

-- CreateIndex
CREATE INDEX "Item_companyId_idx" ON "Item"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_companyId_code_key" ON "Item"("companyId", "code");

-- CreateIndex
CREATE INDEX "ItemGroup_companyId_idx" ON "ItemGroup"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_companyId_code_key" ON "ItemGroup"("companyId", "code");

-- CreateIndex
CREATE INDEX "ItemUnit_companyId_idx" ON "ItemUnit"("companyId");

-- CreateIndex
CREATE INDEX "ItemVariantAttribute_companyId_idx" ON "ItemVariantAttribute"("companyId");

-- CreateIndex
CREATE INDEX "ItemVariantValue_companyId_idx" ON "ItemVariantValue"("companyId");

-- CreateIndex
CREATE INDEX "JournalLine_companyId_idx" ON "JournalLine"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCharge_companyId_number_key" ON "LandedCharge"("companyId", "number");

-- CreateIndex
CREATE INDEX "LandedChargeItem_companyId_idx" ON "LandedChargeItem"("companyId");

-- CreateIndex
CREATE INDEX "LandedChargeShare_companyId_idx" ON "LandedChargeShare"("companyId");

-- CreateIndex
CREATE INDEX "NumberSeriesCounter_companyId_idx" ON "NumberSeriesCounter"("companyId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_companyId_idx" ON "PaymentAllocation"("companyId");

-- CreateIndex
CREATE INDEX "PaymentDeduction_companyId_idx" ON "PaymentDeduction"("companyId");

-- CreateIndex
CREATE INDEX "PaymentTerms_companyId_idx" ON "PaymentTerms"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTerms_companyId_code_key" ON "PaymentTerms"("companyId", "code");

-- CreateIndex
CREATE INDEX "PaymentTermsPart_companyId_idx" ON "PaymentTermsPart"("companyId");

-- CreateIndex
CREATE INDEX "PosApproval_companyId_idx" ON "PosApproval"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PosBill_companyId_number_key" ON "PosBill"("companyId", "number");

-- CreateIndex
CREATE INDEX "PosBillLine_companyId_idx" ON "PosBillLine"("companyId");

-- CreateIndex
CREATE INDEX "PosCashierToken_companyId_idx" ON "PosCashierToken"("companyId");

-- CreateIndex
CREATE INDEX "PosPayment_companyId_idx" ON "PosPayment"("companyId");

-- CreateIndex
CREATE INDEX "Price_companyId_idx" ON "Price"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_companyId_idx" ON "PurchaseOrderLine"("companyId");

-- CreateIndex
CREATE INDEX "ReorderLevel_companyId_idx" ON "ReorderLevel"("companyId");

-- CreateIndex
CREATE INDEX "Role_companyId_idx" ON "Role"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_companyId_code_key" ON "Role"("companyId", "code");

-- CreateIndex
CREATE INDEX "RolePermission_companyId_idx" ON "RolePermission"("companyId");

-- CreateIndex
CREATE INDEX "SerialNumber_companyId_idx" ON "SerialNumber"("companyId");

-- CreateIndex
CREATE INDEX "Session_companyId_idx" ON "Session"("companyId");

-- CreateIndex
CREATE INDEX "ShiftCash_companyId_idx" ON "ShiftCash"("companyId");

-- CreateIndex
CREATE INDEX "ShiftClosing_companyId_idx" ON "ShiftClosing"("companyId");

-- CreateIndex
CREATE INDEX "ShiftClosingLine_companyId_idx" ON "ShiftClosingLine"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_companyId_number_key" ON "StockDocument"("companyId", "number");

-- CreateIndex
CREATE INDEX "StockDocumentLine_companyId_idx" ON "StockDocumentLine"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_code_key" ON "Supplier"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_companyId_number_key" ON "SupplierBill"("companyId", "number");

-- CreateIndex
CREATE INDEX "SupplierBillLine_companyId_idx" ON "SupplierBillLine"("companyId");

-- CreateIndex
CREATE INDEX "SupplierGroup_companyId_idx" ON "SupplierGroup"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierGroup_companyId_code_key" ON "SupplierGroup"("companyId", "code");

-- CreateIndex
CREATE INDEX "TillDevice_companyId_idx" ON "TillDevice"("companyId");

-- CreateIndex
CREATE INDEX "TillPaymentMethod_companyId_idx" ON "TillPaymentMethod"("companyId");

-- CreateIndex
CREATE INDEX "Unit_companyId_idx" ON "Unit"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_companyId_code_key" ON "Unit"("companyId", "code");

-- CreateIndex
CREATE INDEX "UnitConversion_companyId_idx" ON "UnitConversion"("companyId");

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "UserPin_companyId_idx" ON "UserPin"("companyId");

-- CreateIndex
CREATE INDEX "UserRole_companyId_idx" ON "UserRole"("companyId");

-- CreateIndex
CREATE INDEX "UserStore_companyId_idx" ON "UserStore"("companyId");

-- CreateIndex
CREATE INDEX "VariantAttribute_companyId_idx" ON "VariantAttribute"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttribute_companyId_code_key" ON "VariantAttribute"("companyId", "code");

-- CreateIndex
CREATE INDEX "VariantAttributeValue_companyId_idx" ON "VariantAttributeValue"("companyId");

-- People and their sessions point at their shop.
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shops that existed before sign-up was built are set up already.
ALTER TABLE "Company" ADD COLUMN "setupCompletedAt" TIMESTAMP(3);
UPDATE "Company" SET "setupCompletedAt" = "createdAt";

-- The role every shop's requests run as. It cannot see past row-level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_erp_app') THEN
    CREATE ROLE retail_erp_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT retail_erp_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO retail_erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO retail_erp_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO retail_erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retail_erp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO retail_erp_app;
REVOKE ALL ON TABLE "_prisma_migrations" FROM retail_erp_app;

-- Each shop sees only its own rows; with no shop set it sees nothing.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Company"
  USING (id = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GstRegistration" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstRegistration"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Store"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "FinancialYear" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "FinancialYear"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "NumberSeries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "NumberSeries"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "NumberSeriesCounter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "NumberSeriesCounter"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "User"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Role"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "RolePermission"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "UserRole"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "UserStore" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "UserStore"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Session"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SecuritySettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SecuritySettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "AuditLog"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Unit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Unit"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "UnitConversion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "UnitConversion"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ItemGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ItemGroup"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Brand" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Brand"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "HsnCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "HsnCode"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "VariantAttribute" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "VariantAttribute"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "VariantAttributeValue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "VariantAttributeValue"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Item"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ItemUnit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ItemUnit"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Barcode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Barcode"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ItemVariantAttribute" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ItemVariantAttribute"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ItemVariantValue" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ItemVariantValue"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PriceList" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PriceList"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Price" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Price"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CatalogueSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CatalogueSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Address" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Address"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ContactPerson" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ContactPerson"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PaymentTerms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PaymentTerms"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PaymentTermsPart" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PaymentTermsPart"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CustomerGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CustomerGroup"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Customer"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SupplierGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SupplierGroup"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Supplier"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PartySettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PartySettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockLocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockLocation"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockDocument"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockDocumentLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockDocumentLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockLedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockLedgerEntry"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockPosition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockPosition"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Batch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Batch"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "BatchPosition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "BatchPosition"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SerialNumber" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SerialNumber"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ReorderLevel" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ReorderLevel"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "InventorySettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "InventorySettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PurchaseOrder"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PurchaseOrderLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GoodsReceipt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GoodsReceipt"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GoodsReceiptLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GoodsReceiptLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SupplierBill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SupplierBill"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SupplierBillLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SupplierBillLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LandedCharge" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LandedCharge"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LandedChargeItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LandedChargeItem"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LandedChargeShare" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LandedChargeShare"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ReorderSuggestion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ReorderSuggestion"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PurchaseSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PurchaseSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GstRate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstRate"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PaymentMethod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PaymentMethod"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Till" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Till"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "TillPaymentMethod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "TillPaymentMethod"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "TillDevice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "TillDevice"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "UserPin" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "UserPin"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Shift"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ShiftCash" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ShiftCash"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CashMovement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CashMovement"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ShiftClosing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ShiftClosing"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ShiftClosingLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ShiftClosingLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosBill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosBill"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosBillLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosBillLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosPayment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosPayment"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Offer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Offer"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Coupon"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosApproval" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosApproval"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosCashierToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosCashierToken"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosSyncProblem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosSyncProblem"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Account"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "AccountDefault" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "AccountDefault"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "AccountingSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "AccountingSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LedgerEntry"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LedgerLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LedgerLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Settlement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Settlement"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Journal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Journal"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "JournalLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Payment"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PaymentAllocation"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PaymentDeduction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PaymentDeduction"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "OpeningBill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "OpeningBill"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "BankAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "BankAccount"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "YearEndClosing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "YearEndClosing"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SummaryEmailSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SummaryEmailSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SummaryEmailRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SummaryEmailRun"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PrintSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PrintSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StandardTerms" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StandardTerms"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LabelTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LabelTemplate"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ImportJob"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ImportRow" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ImportRow"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "TrialClearing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "TrialClearing"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SalesStaff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SalesStaff"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Season" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Season"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "Markdown" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "Markdown"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "PosDelivery" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "PosDelivery"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CustomerOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CustomerOrder"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CustomerOrderLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CustomerOrderLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "StockReservation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "StockReservation"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "AlterationJob" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "AlterationJob"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "AlterationJobLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "AlterationJobLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ConsignmentStatement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ConsignmentStatement"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "ConsignmentStatementLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "ConsignmentStatementLine"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "TallyLedgerMap" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "TallyLedgerMap"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GstSettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstSettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "EInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "EInvoice"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "EWayBill" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "EWayBill"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GstReturnUpload" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GstReturnUpload"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "CompanyModule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "CompanyModule"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "SetupProgress" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "SetupProgress"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LoyaltySettings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LoyaltySettings"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LoyaltyTier" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LoyaltyTier"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "LoyaltyEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "LoyaltyEntry"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GiftCard"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE "GiftCardEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "GiftCardEntry"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);


-- Landing page messages: above the shops. Row-level security with no rule lets
-- no shop see them; only the system client (Rademics) does.
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "shopName" TEXT,
    "shopType" TEXT,
    "message" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;

-- Clearing a shop's trial data (decision 72) deletes only that shop's rows, one
-- by one, instead of emptying whole tables (which would clear every shop). The
-- guards on posted ledger and stock lines allow it only inside the clearing
-- transaction, which sets app.clear_trial for itself.
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.clear_trial', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows cannot be changed or deleted; post a reversing entry instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

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
     OR NEW."postingAt" <> OLD."postingAt" OR NEW."kind" <> OLD."kind" OR NEW."intentQuantity" <> OLD."intentQuantity" THEN
    RAISE EXCEPTION 'Re-costing may only change derived figures';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The setting used while adding the columns is not kept.
SELECT set_config('app.company_id', '', false);
