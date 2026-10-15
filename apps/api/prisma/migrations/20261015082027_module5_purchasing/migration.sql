-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'to_receive_and_bill', 'to_receive', 'to_bill', 'completed', 'on_hold', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('draft', 'to_bill', 'partly_billed', 'completed', 'returned', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "SupplierBillStatus" AS ENUM ('draft', 'unpaid', 'cancelled');

-- CreateEnum
CREATE TYPE "SupplierBillKind" AS ENUM ('against_receipt', 'receives_goods', 'services', 'debit_note');

-- CreateEnum
CREATE TYPE "PurchaseDocStatus" AS ENUM ('draft', 'finalised', 'cancelled');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "minOrderQuantity" DECIMAL(18,3),
ADD COLUMN     "overReceiptPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "StockLedgerEntry" ADD COLUMN     "documentType" TEXT NOT NULL DEFAULT 'stock_document';

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderDate" DATE NOT NULL,
    "neededBy" DATE NOT NULL,
    "storeId" UUID NOT NULL,
    "supplierQuoteRef" TEXT,
    "paymentTermsId" UUID,
    "dueDate" DATE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "statusBeforeHold" "PurchaseOrderStatus",
    "taxableAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "receivedPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "billedPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "approvedById" UUID,
    "holdReason" TEXT,
    "closeReason" TEXT,
    "remarks" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "freeQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "basicQuantity" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(16,4) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(16,2) NOT NULL,
    "storeId" UUID NOT NULL,
    "neededBy" DATE NOT NULL,
    "receivedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "billedAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "postingDate" DATE NOT NULL,
    "postingAt" TIMESTAMP(3) NOT NULL,
    "deliveryNoteNo" TEXT,
    "transporterName" TEXT,
    "vehicleNo" TEXT,
    "noOrderReason" TEXT,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'draft',
    "isReturn" BOOLEAN NOT NULL DEFAULT false,
    "returnOfId" UUID,
    "billId" UUID,
    "taxableAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "stockValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "billedPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "returnedPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "checkedById" UUID,
    "checkedAt" TIMESTAMP(3),
    "checkResult" TEXT,
    "checkRemarks" TEXT,
    "isBackDated" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "orderLineId" UUID,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "receivedQuantity" DECIMAL(18,3) NOT NULL,
    "acceptedQuantity" DECIMAL(18,3) NOT NULL,
    "rejectedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "freeQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "basicAcceptedQuantity" DECIMAL(18,3) NOT NULL,
    "basicRejectedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(16,4) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(16,2) NOT NULL,
    "extraCharges" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "shelfLocationId" UUID NOT NULL,
    "rejectedLocationId" UUID,
    "batchId" UUID,
    "newBatchNumber" TEXT,
    "newManufactureOn" DATE,
    "newExpiryOn" DATE,
    "serialNumbers" TEXT[],
    "rejectedSerialNumbers" TEXT[],
    "billedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "returnedAcceptedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "returnedRejectedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "returnOfLineId" UUID,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBill" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "kind" "SupplierBillKind" NOT NULL,
    "supplierBillNo" TEXT NOT NULL,
    "supplierBillDate" DATE NOT NULL,
    "postingDate" DATE NOT NULL,
    "postingAt" TIMESTAMP(3) NOT NULL,
    "financialYearId" UUID NOT NULL,
    "storeId" UUID,
    "paymentTermsId" UUID,
    "dueDate" DATE NOT NULL,
    "status" "SupplierBillStatus" NOT NULL DEFAULT 'draft',
    "holdReason" TEXT,
    "holdUntil" DATE,
    "taxableAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "roundingAdjustment" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "priceDifference" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "priceDifferenceConfirmedById" UUID,
    "returnOfId" UUID,
    "receiptId" UUID,
    "remarks" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBillLine" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "receiptLineId" UUID,
    "orderLineId" UUID,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "freeQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "basicQuantity" DECIMAL(18,3) NOT NULL,
    "rate" DECIMAL(16,4) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(16,2) NOT NULL,
    "priceDifference" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "accountRole" TEXT NOT NULL,
    "returnOfLineId" UUID,
    "returnedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandedCharge" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "status" "PurchaseDocStatus" NOT NULL DEFAULT 'draft',
    "shareBy" TEXT NOT NULL,
    "transporterBillId" UUID,
    "total" DECIMAL(16,2) NOT NULL,
    "receiptIds" UUID[],
    "remarks" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LandedCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandedChargeItem" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "chargeType" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "LandedChargeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandedChargeShare" (
    "id" UUID NOT NULL,
    "chargeId" UUID NOT NULL,
    "receiptLineId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "LandedChargeShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderSuggestion" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "supplierId" UUID,
    "onHand" DECIMAL(18,3) NOT NULL,
    "onOrder" DECIMAL(18,3) NOT NULL,
    "reorderLevel" DECIMAL(18,3) NOT NULL,
    "reorderQuantity" DECIMAL(18,3) NOT NULL,
    "suggestedQuantity" DECIMAL(18,3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "orderLineId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ReorderSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseSettings" (
    "companyId" UUID NOT NULL,
    "requireOrderForReceipt" BOOLEAN NOT NULL DEFAULT false,
    "overOrderPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "overReceiptPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "overBillingPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "priceMismatch" TEXT NOT NULL DEFAULT 'warn',
    "checkSupplierBillNo" BOOLEAN NOT NULL DEFAULT true,
    "approvalLimit" DECIMAL(16,2) NOT NULL DEFAULT 50000,
    "fillLastPurchasePrice" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PurchaseSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_idx" ON "PurchaseOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_itemId_idx" ON "PurchaseOrderLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_number_key" ON "GoodsReceipt"("number");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_status_idx" ON "GoodsReceipt"("companyId", "status");

-- CreateIndex
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_orderLineId_idx" ON "GoodsReceiptLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBill_number_key" ON "SupplierBill"("number");

-- CreateIndex
CREATE INDEX "SupplierBill_companyId_status_idx" ON "SupplierBill"("companyId", "status");

-- CreateIndex
CREATE INDEX "SupplierBill_supplierId_supplierBillNo_idx" ON "SupplierBill"("supplierId", "supplierBillNo");

-- CreateIndex
CREATE INDEX "SupplierBillLine_billId_idx" ON "SupplierBillLine"("billId");

-- CreateIndex
CREATE INDEX "SupplierBillLine_receiptLineId_idx" ON "SupplierBillLine"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "LandedCharge_number_key" ON "LandedCharge"("number");

-- CreateIndex
CREATE INDEX "LandedCharge_companyId_status_idx" ON "LandedCharge"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LandedChargeShare_chargeId_receiptLineId_key" ON "LandedChargeShare"("chargeId", "receiptLineId");

-- CreateIndex
CREATE INDEX "ReorderSuggestion_companyId_status_idx" ON "ReorderSuggestion"("companyId", "status");

-- CreateIndex
CREATE INDEX "ReorderSuggestion_storeId_itemId_idx" ON "ReorderSuggestion"("storeId", "itemId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "GoodsReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierBillLine" ADD CONSTRAINT "SupplierBillLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedChargeItem" ADD CONSTRAINT "LandedChargeItem_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "LandedCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedChargeShare" ADD CONSTRAINT "LandedChargeShare_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "LandedCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandedChargeShare" ADD CONSTRAINT "LandedChargeShare_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "GoodsReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReorderSuggestion" ADD CONSTRAINT "ReorderSuggestion_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission keys for the system roles (plan 05 §3; decision 70: cashiers get none).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'purchase.view'), ('owner_admin', 'purchase.order'), ('owner_admin', 'purchase.approve'),
  ('owner_admin', 'purchase.receive'), ('owner_admin', 'purchase.receive_without_order'), ('owner_admin', 'purchase.over_receive'),
  ('owner_admin', 'purchase.bill'), ('owner_admin', 'purchase.return'), ('owner_admin', 'purchase.charges'),
  ('owner_admin', 'purchase.settings'),
  ('accountant', 'purchase.view'), ('accountant', 'purchase.bill'), ('accountant', 'purchase.return'),
  ('accountant', 'purchase.charges'), ('accountant', 'purchase.settings'),
  ('store_manager', 'purchase.view'), ('store_manager', 'purchase.order'), ('store_manager', 'purchase.approve'),
  ('store_manager', 'purchase.receive'), ('store_manager', 'purchase.receive_without_order'), ('store_manager', 'purchase.return'),
  ('stock_receiving', 'purchase.view'), ('stock_receiving', 'purchase.receive'),
  ('viewer_auditor', 'purchase.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
