-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('folder', 'shelf', 'transit', 'rejected');

-- CreateEnum
CREATE TYPE "StockDocKind" AS ENUM ('stock_in', 'stock_out', 'move', 'transfer_send', 'transfer_receive', 'count');

-- CreateEnum
CREATE TYPE "StockDocStatus" AS ENUM ('draft', 'finalised', 'cancelled');

-- CreateEnum
CREATE TYPE "StockEntryKind" AS ENUM ('in', 'out', 'set', 'reverse');

-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('in_stock', 'in_transit', 'out');

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID,
    "parentId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LocationKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "StockDocKind" NOT NULL,
    "reason" TEXT,
    "countType" TEXT,
    "blind" BOOLEAN NOT NULL DEFAULT false,
    "status" "StockDocStatus" NOT NULL DEFAULT 'draft',
    "postingDate" DATE NOT NULL,
    "postingAt" TIMESTAMP(3) NOT NULL,
    "storeId" UUID NOT NULL,
    "toStoreId" UUID,
    "fromLocationId" UUID,
    "toLocationId" UUID,
    "sendDocumentId" UUID,
    "remarks" TEXT,
    "isBackDated" BOOLEAN NOT NULL DEFAULT false,
    "totalValueIn" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "totalValueOut" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "finalisedAt" TIMESTAMP(3),
    "finalisedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocumentLine" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "basicQuantity" DECIMAL(18,3) NOT NULL,
    "batchId" UUID,
    "newBatchNumber" TEXT,
    "newManufactureOn" DATE,
    "newExpiryOn" DATE,
    "serialNumbers" TEXT[],
    "unitCost" DECIMAL(16,4),
    "expectedQuantity" DECIMAL(18,3),
    "countedQuantity" DECIMAL(18,3),
    "valueChange" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "receivedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "sendLineId" UUID,

    CONSTRAINT "StockDocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedgerEntry" (
    "id" BIGSERIAL NOT NULL,
    "companyId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "batchId" UUID,
    "documentId" UUID NOT NULL,
    "documentLineId" UUID NOT NULL,
    "postingDate" DATE NOT NULL,
    "postingAt" TIMESTAMP(3) NOT NULL,
    "kind" "StockEntryKind" NOT NULL,
    "intentQuantity" DECIMAL(18,3) NOT NULL,
    "incomingCost" DECIMAL(16,4),
    "targetCost" DECIMAL(16,4),
    "costSourceId" BIGINT,
    "reversesId" BIGINT,
    "quantityChange" DECIMAL(18,3) NOT NULL,
    "valueChange" DECIMAL(16,2) NOT NULL,
    "unitCost" DECIMAL(16,4) NOT NULL,
    "quantityAfter" DECIMAL(18,3) NOT NULL,
    "unitCostAfter" DECIMAL(16,4) NOT NULL,
    "valueAfter" DECIMAL(16,2) NOT NULL,
    "accountRole" TEXT NOT NULL,
    "isCancellation" BOOLEAN NOT NULL DEFAULT false,
    "wentNegative" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "StockLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockPosition" (
    "itemId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "lastPostingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockPosition_pkey" PRIMARY KEY ("itemId","locationId")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "manufactureDate" DATE,
    "expiryDate" DATE,
    "supplierId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchPosition" (
    "batchId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchPosition_pkey" PRIMARY KEY ("batchId","locationId")
);

-- CreateTable
CREATE TABLE "SerialNumber" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "status" "SerialStatus" NOT NULL,
    "locationId" UUID,
    "batchId" UUID,
    "inDocumentId" UUID,
    "outDocumentId" UUID,
    "warrantyUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "SerialNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReorderLevel" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "level" DECIMAL(18,3) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "requestType" TEXT NOT NULL DEFAULT 'buy',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ReorderLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySettings" (
    "companyId" UUID NOT NULL,
    "stockLockDate" DATE,
    "allowNegativeAtTill" BOOLEAN NOT NULL DEFAULT true,
    "batchPickOrder" TEXT NOT NULL DEFAULT 'earliest_expiry',
    "transitLocationId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "StockLocation_storeId_idx" ON "StockLocation"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_companyId_code_key" ON "StockLocation"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_number_key" ON "StockDocument"("number");

-- CreateIndex
CREATE INDEX "StockDocument_companyId_kind_status_idx" ON "StockDocument"("companyId", "kind", "status");

-- CreateIndex
CREATE INDEX "StockDocument_storeId_postingDate_idx" ON "StockDocument"("storeId", "postingDate");

-- CreateIndex
CREATE INDEX "StockDocumentLine_documentId_idx" ON "StockDocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_itemId_locationId_postingAt_id_idx" ON "StockLedgerEntry"("itemId", "locationId", "postingAt", "id");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_documentId_idx" ON "StockLedgerEntry"("documentId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_costSourceId_idx" ON "StockLedgerEntry"("costSourceId");

-- CreateIndex
CREATE INDEX "StockLedgerEntry_postingDate_idx" ON "StockLedgerEntry"("postingDate");

-- CreateIndex
CREATE INDEX "StockPosition_locationId_idx" ON "StockPosition"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_itemId_batchNumber_key" ON "Batch"("itemId", "batchNumber");

-- CreateIndex
CREATE INDEX "SerialNumber_locationId_idx" ON "SerialNumber"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialNumber_itemId_serial_key" ON "SerialNumber"("itemId", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "ReorderLevel_itemId_storeId_key" ON "ReorderLevel"("itemId", "storeId");

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocument" ADD CONSTRAINT "StockDocument_sendDocumentId_fkey" FOREIGN KEY ("sendDocumentId") REFERENCES "StockDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StockDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockDocumentLine" ADD CONSTRAINT "StockDocumentLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchPosition" ADD CONSTRAINT "BatchPosition_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Module 4: the stock ledger is append-only. Rows can never be deleted, and
-- only the re-costing routine (which sets app.stock_recost = 'on' inside its
-- own transaction) may rewrite the derived figures of existing rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER stock_ledger_no_delete BEFORE DELETE ON "StockLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION stock_ledger_guard();
CREATE TRIGGER stock_ledger_guard_update BEFORE UPDATE ON "StockLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION stock_ledger_guard();

-- Permission keys for the system roles (decision 70: cashiers see quantities only).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'stock.view'), ('owner_admin', 'stock.move'), ('owner_admin', 'stock.count'),
  ('owner_admin', 'stock.adjust_finalise'), ('owner_admin', 'stock.backdate'), ('owner_admin', 'stock.lock'),
  ('owner_admin', 'stock.cost.view'), ('owner_admin', 'stock.locations.manage'),
  ('accountant', 'stock.view'), ('accountant', 'stock.adjust_finalise'), ('accountant', 'stock.backdate'),
  ('accountant', 'stock.lock'), ('accountant', 'stock.cost.view'),
  ('store_manager', 'stock.view'), ('store_manager', 'stock.move'), ('store_manager', 'stock.count'),
  ('store_manager', 'stock.adjust_finalise'), ('store_manager', 'stock.cost.view'), ('store_manager', 'stock.locations.manage'),
  ('cashier', 'stock.view'),
  ('stock_receiving', 'stock.view'), ('stock_receiving', 'stock.move'), ('stock_receiving', 'stock.count'),
  ('viewer_auditor', 'stock.view'), ('viewer_auditor', 'stock.cost.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
