-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('count', 'weight', 'length', 'volume', 'other');

-- CreateEnum
CREATE TYPE "AttributeKind" AS ENUM ('list', 'numeric');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('EAN13', 'EAN8', 'UPCA', 'CODE39', 'other');

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "UnitKind" NOT NULL,
    "allowsFractions" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" UUID NOT NULL,
    "fromUnitId" UUID NOT NULL,
    "toUnitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "hsnCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HsnCode" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isService" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "HsnCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantAttribute" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AttributeKind" NOT NULL DEFAULT 'list',
    "rangeStart" DECIMAL(12,4),
    "rangeEnd" DECIMAL(12,4),
    "rangeStep" DECIMAL(12,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "VariantAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantAttributeValue" (
    "id" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "valueKey" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantAttributeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image" BYTEA,
    "imageMimeType" TEXT,
    "itemGroupId" UUID NOT NULL,
    "brandId" UUID,
    "baseUnitId" UUID NOT NULL,
    "hsnCode" TEXT,
    "mrp" DECIMAL(14,2),
    "maxDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isStockItem" BOOLEAN NOT NULL DEFAULT true,
    "canBuy" BOOLEAN NOT NULL DEFAULT true,
    "canSell" BOOLEAN NOT NULL DEFAULT true,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isParentStyle" BOOLEAN NOT NULL DEFAULT false,
    "parentItemId" UUID,
    "variantKey" TEXT,
    "trackBatches" BOOLEAN NOT NULL DEFAULT false,
    "autoNumberBatches" BOOLEAN NOT NULL DEFAULT false,
    "shelfLifeDays" INTEGER,
    "trackSerials" BOOLEAN NOT NULL DEFAULT false,
    "warrantyDays" INTEGER,
    "lastPurchasePrice" DECIMAL(16,4),
    "preferredSupplierId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemUnit" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "mrp" DECIMAL(14,2),

    CONSTRAINT "ItemUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barcode" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID,
    "type" "BarcodeType" NOT NULL DEFAULT 'other',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemVariantAttribute" (
    "itemId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemVariantAttribute_pkey" PRIMARY KEY ("itemId","attributeId")
);

-- CreateTable
CREATE TABLE "ItemVariantValue" (
    "itemId" UUID NOT NULL,
    "attributeId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,

    CONSTRAINT "ItemVariantValue_pkey" PRIMARY KEY ("itemId","attributeId")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "forSelling" BOOLEAN NOT NULL DEFAULT true,
    "forBuying" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "pricesPerUnit" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "price" DECIMAL(16,4) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "packSize" DECIMAL(18,6),
    "customerId" UUID,
    "supplierId" UUID,
    "batchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueSettings" (
    "companyId" UUID NOT NULL,
    "autoItemCodes" BOOLEAN NOT NULL DEFAULT true,
    "defaultItemGroupId" UUID,
    "defaultUnitId" UUID,
    "defaultSellingPriceListId" UUID,
    "defaultBuyingPriceListId" UUID,
    "fallbackToDefaultSellingList" BOOLEAN NOT NULL DEFAULT true,
    "allowPriceChangeOnBill" BOOLEAN NOT NULL DEFAULT false,
    "blockSellingBelowCost" BOOLEAN NOT NULL DEFAULT false,
    "saveTypedPrices" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CatalogueSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_code_key" ON "Unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_fromUnitId_toUnitId_key" ON "UnitConversion"("fromUnitId", "toUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemGroup_code_key" ON "ItemGroup"("code");

-- CreateIndex
CREATE INDEX "ItemGroup_path_idx" ON "ItemGroup"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_code_key" ON "Brand"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_code_key" ON "HsnCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttribute_code_key" ON "VariantAttribute"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttributeValue_attributeId_valueKey_key" ON "VariantAttributeValue"("attributeId", "valueKey");

-- CreateIndex
CREATE UNIQUE INDEX "VariantAttributeValue_attributeId_shortCode_key" ON "VariantAttributeValue"("attributeId", "shortCode");

-- CreateIndex
CREATE UNIQUE INDEX "Item_code_key" ON "Item"("code");

-- CreateIndex
CREATE INDEX "Item_name_idx" ON "Item"("name");

-- CreateIndex
CREATE INDEX "Item_itemGroupId_idx" ON "Item"("itemGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Item_parentItemId_variantKey_key" ON "Item"("parentItemId", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "ItemUnit_itemId_unitId_key" ON "ItemUnit"("itemId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Barcode_code_key" ON "Barcode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_companyId_code_key" ON "PriceList"("companyId", "code");

-- CreateIndex
CREATE INDEX "Price_priceListId_itemId_idx" ON "Price"("priceListId", "itemId");

-- CreateIndex
CREATE INDEX "Price_itemId_idx" ON "Price"("itemId");

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_fromUnitId_fkey" FOREIGN KEY ("fromUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_toUnitId_fkey" FOREIGN KEY ("toUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "VariantAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_itemGroupId_fkey" FOREIGN KEY ("itemGroupId") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVariantAttribute" ADD CONSTRAINT "ItemVariantAttribute_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVariantAttribute" ADD CONSTRAINT "ItemVariantAttribute_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "VariantAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVariantValue" ADD CONSTRAINT "ItemVariantValue_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVariantValue" ADD CONSTRAINT "ItemVariantValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "VariantAttribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogueSettings" ADD CONSTRAINT "CatalogueSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Module 2 data: give the new permission keys to the system roles that
-- already exist (decision 70: cashiers get no cost or buying prices), and
-- seed the standard units and conversions shared by every company.
-- ---------------------------------------------------------------------------

INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('accountant',     'catalogue.view'),
  ('accountant',     'prices.view'),
  ('accountant',     'buying_prices.view'),
  ('accountant',     'cost_price.view'),
  ('store_manager',  'catalogue.view'),
  ('store_manager',  'prices.view'),
  ('cashier',        'catalogue.view'),
  ('cashier',        'prices.view'),
  ('stock_receiving','catalogue.view'),
  ('viewer_auditor', 'catalogue.view'),
  ('viewer_auditor', 'prices.view'),
  ('viewer_auditor', 'buying_prices.view'),
  ('viewer_auditor', 'cost_price.view'),
  ('owner_admin',    'catalogue.view'),
  ('owner_admin',    'catalogue.manage'),
  ('owner_admin',    'prices.view'),
  ('owner_admin',    'prices.manage'),
  ('owner_admin',    'buying_prices.view'),
  ('owner_admin',    'cost_price.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;

INSERT INTO "Unit" ("id", "code", "name", "kind", "allowsFractions", "updatedAt") VALUES
  (gen_random_uuid(), 'PCS', 'Piece',      'count',  false, now()),
  (gen_random_uuid(), 'BOX', 'Box',        'count',  false, now()),
  (gen_random_uuid(), 'PKT', 'Packet',     'count',  false, now()),
  (gen_random_uuid(), 'DOZ', 'Dozen',      'count',  false, now()),
  (gen_random_uuid(), 'KG',  'Kilogram',   'weight', true,  now()),
  (gen_random_uuid(), 'G',   'Gram',       'weight', true,  now()),
  (gen_random_uuid(), 'L',   'Litre',      'volume', true,  now()),
  (gen_random_uuid(), 'ML',  'Millilitre', 'volume', true,  now()),
  (gen_random_uuid(), 'M',   'Metre',      'length', true,  now()),
  (gen_random_uuid(), 'CM',  'Centimetre', 'length', true,  now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "UnitConversion" ("id", "fromUnitId", "toUnitId", "factor", "updatedAt")
SELECT gen_random_uuid(), f."id", t."id", c."factor", now()
FROM (VALUES ('KG', 'G', 1000), ('L', 'ML', 1000), ('M', 'CM', 100), ('DOZ', 'PCS', 12)) AS c("from", "to", "factor")
JOIN "Unit" f ON f."code" = c."from"
JOIN "Unit" t ON t."code" = c."to"
ON CONFLICT DO NOTHING;
