-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('customer', 'supplier');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('active', 'blocked', 'off');

-- CreateEnum
CREATE TYPE "HoldType" AS ENUM ('none', 'bills', 'payments', 'all');

-- CreateEnum
CREATE TYPE "DueBasis" AS ENUM ('days_after_date', 'days_after_month_end', 'months_then_month_end');

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "partyType" "PartyType" NOT NULL,
    "partyId" UUID NOT NULL,
    "label" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "pincode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "isBilling" BOOLEAN NOT NULL DEFAULT true,
    "isDelivery" BOOLEAN NOT NULL DEFAULT true,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPerson" (
    "id" UUID NOT NULL,
    "partyType" "PartyType" NOT NULL,
    "partyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "noPromotions" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "ContactPerson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTerms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PaymentTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTermsPart" (
    "id" UUID NOT NULL,
    "paymentTermsId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "share" DECIMAL(5,2) NOT NULL,
    "dueBasis" "DueBasis" NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "months" INTEGER NOT NULL DEFAULT 0,
    "earlyDiscountPercent" DECIMAL(5,2),
    "earlyDiscountDays" INTEGER,

    CONSTRAINT "PaymentTermsPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "priceListId" UUID,
    "paymentTermsId" UUID,
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overdueLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "skipCreditCheck" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "mobile" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "customerGroupId" UUID NOT NULL,
    "gstin" TEXT,
    "stateCode" TEXT,
    "priceListId" UUID,
    "paymentTermsId" UUID,
    "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overdueLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditCheckAtDelivery" BOOLEAN NOT NULL DEFAULT false,
    "status" "PartyStatus" NOT NULL DEFAULT 'active',
    "isWalkIn" BOOLEAN NOT NULL DEFAULT false,
    "linkedSupplierId" UUID,
    "offlineTillRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierGroup" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "priceListId" UUID,
    "paymentTermsId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "SupplierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBusiness" BOOLEAN NOT NULL DEFAULT true,
    "mobile" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "supplierGroupId" UUID NOT NULL,
    "isTransporter" BOOLEAN NOT NULL DEFAULT false,
    "gstin" TEXT,
    "pan" TEXT,
    "stateCode" TEXT,
    "priceListId" UUID,
    "paymentTermsId" UUID,
    "bankAccountNote" TEXT,
    "status" "PartyStatus" NOT NULL DEFAULT 'active',
    "holdType" "HoldType" NOT NULL DEFAULT 'none',
    "holdUntil" DATE,
    "holdReason" TEXT,
    "allowBillWithoutOrder" BOOLEAN NOT NULL DEFAULT false,
    "allowBillWithoutReceipt" BOOLEAN NOT NULL DEFAULT false,
    "linkedCustomerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartySettings" (
    "companyId" UUID NOT NULL,
    "defaultCustomerGroupId" UUID,
    "defaultSupplierGroupId" UUID,
    "defaultPaymentTermsId" UUID,
    "defaultCreditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "walkInCustomerId" UUID,
    "gstTreatmentFrom" TEXT NOT NULL DEFAULT 'billing',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PartySettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "Address_partyType_partyId_idx" ON "Address"("partyType", "partyId");

-- CreateIndex
CREATE INDEX "ContactPerson_partyType_partyId_idx" ON "ContactPerson"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTerms_code_key" ON "PaymentTerms"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_code_key" ON "CustomerGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_mobile_idx" ON "Customer"("mobile");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierGroup_code_key" ON "SupplierGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Price" ADD CONSTRAINT "Price_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTermsPart" ADD CONSTRAINT "PaymentTermsPart_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "PaymentTerms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerGroup" ADD CONSTRAINT "CustomerGroup_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "PaymentTerms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "PaymentTerms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_linkedSupplierId_fkey" FOREIGN KEY ("linkedSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierGroup" ADD CONSTRAINT "SupplierGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SupplierGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierGroup" ADD CONSTRAINT "SupplierGroup_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierGroup" ADD CONSTRAINT "SupplierGroup_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "PaymentTerms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_supplierGroupId_fkey" FOREIGN KEY ("supplierGroupId") REFERENCES "SupplierGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_paymentTermsId_fkey" FOREIGN KEY ("paymentTermsId") REFERENCES "PaymentTerms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartySettings" ADD CONSTRAINT "PartySettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Module 3 data: permission keys for the system roles, standard payment
-- terms and the starting customer and supplier groups (shared by all
-- companies). Per-company rows (walk-in customer, settings, number series)
-- are created in code on first start and at setup.
-- ---------------------------------------------------------------------------

INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin',     'customers.view'),
  ('owner_admin',     'customers.quick_add'),
  ('owner_admin',     'customers.manage'),
  ('owner_admin',     'customers.credit'),
  ('owner_admin',     'suppliers.view'),
  ('owner_admin',     'suppliers.manage'),
  ('owner_admin',     'suppliers.hold'),
  ('owner_admin',     'payment_terms.manage'),
  ('accountant',      'customers.view'),
  ('accountant',      'customers.credit'),
  ('accountant',      'suppliers.view'),
  ('accountant',      'suppliers.hold'),
  ('accountant',      'payment_terms.manage'),
  ('store_manager',   'customers.view'),
  ('store_manager',   'customers.quick_add'),
  ('store_manager',   'customers.manage'),
  ('store_manager',   'suppliers.view'),
  ('cashier',         'customers.view'),
  ('cashier',         'customers.quick_add'),
  ('stock_receiving', 'suppliers.view'),
  ('viewer_auditor',  'customers.view'),
  ('viewer_auditor',  'suppliers.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;

INSERT INTO "PaymentTerms" ("id", "code", "name", "updatedAt") VALUES
  (gen_random_uuid(), 'CASH',  'Cash',   now()),
  (gen_random_uuid(), 'NET15', 'Net 15', now()),
  (gen_random_uuid(), 'NET30', 'Net 30', now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "PaymentTermsPart" ("id", "paymentTermsId", "sortOrder", "share", "dueBasis", "days", "months")
SELECT gen_random_uuid(), t."id", 0, 100, 'days_after_date', p."days", 0
FROM (VALUES ('CASH', 0), ('NET15', 15), ('NET30', 30)) AS p("code", "days")
JOIN "PaymentTerms" t ON t."code" = p."code"
WHERE NOT EXISTS (SELECT 1 FROM "PaymentTermsPart" x WHERE x."paymentTermsId" = t."id");

INSERT INTO "CustomerGroup" ("id", "code", "name", "path", "updatedAt")
SELECT gen_random_uuid(), g."code", g."name", '', now()
FROM (VALUES ('RETAIL', 'Retail'), ('WHOLESALE', 'Wholesale'), ('STAFF', 'Staff')) AS g("code", "name")
ON CONFLICT ("code") DO NOTHING;
UPDATE "CustomerGroup" SET "path" = '/' || "id" || '/' WHERE "path" = '';

INSERT INTO "SupplierGroup" ("id", "code", "name", "path", "updatedAt")
SELECT gen_random_uuid(), g."code", g."name", '', now()
FROM (VALUES ('DISTRIBUTORS', 'Distributors'), ('LOCAL', 'Local vendors'), ('SERVICES', 'Services'), ('TRANSPORT', 'Transporters')) AS g("code", "name")
ON CONFLICT ("code") DO NOTHING;
UPDATE "SupplierGroup" SET "path" = '/' || "id" || '/' WHERE "path" = '';
