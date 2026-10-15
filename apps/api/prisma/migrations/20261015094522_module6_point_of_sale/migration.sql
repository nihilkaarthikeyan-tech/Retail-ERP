-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('cash', 'card', 'upi', 'other');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "PosBillKind" AS ENUM ('sale', 'return');

-- CreateEnum
CREATE TYPE "PosBillStatus" AS ENUM ('completed', 'cancelled');

-- CreateTable
CREATE TABLE "GstRate" (
    "id" UUID NOT NULL,
    "hsnCode" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "cessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "effectiveFrom" DATE NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "GstRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "allowRefund" BOOLEAN NOT NULL DEFAULT true,
    "needsReference" BOOLEAN NOT NULL DEFAULT false,
    "accountRole" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Till" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "seriesKind" TEXT NOT NULL,
    "cashierDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "allowPriceChange" BOOLEAN NOT NULL DEFAULT false,
    "autoPrint" BOOLEAN NOT NULL DEFAULT true,
    "receiptFooter" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Till_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TillPaymentMethod" (
    "tillId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TillPaymentMethod_pkey" PRIMARY KEY ("tillId","paymentMethodId")
);

-- CreateTable
CREATE TABLE "TillDevice" (
    "id" UUID NOT NULL,
    "tillId" UUID NOT NULL,
    "deviceName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "registeredById" UUID,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TillDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPin" (
    "userId" UUID NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tillId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "businessDate" DATE NOT NULL,
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCash" (
    "shiftId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "ShiftCash_pkey" PRIMARY KEY ("shiftId","paymentMethodId")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "byId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftClosing" (
    "id" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "closedById" UUID NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "denominations" JSONB NOT NULL,
    "remarks" TEXT,
    "approvedById" UUID,
    "bills" INTEGER NOT NULL,
    "salesTotal" DECIMAL(16,2) NOT NULL,
    "returnsTotal" DECIMAL(16,2) NOT NULL,
    "taxableTotal" DECIMAL(16,2) NOT NULL,
    "cgstTotal" DECIMAL(16,2) NOT NULL,
    "sgstTotal" DECIMAL(16,2) NOT NULL,
    "igstTotal" DECIMAL(16,2) NOT NULL,
    "roundingTotal" DECIMAL(16,2) NOT NULL,
    "costTotal" DECIMAL(16,2) NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftClosingLine" (
    "id" UUID NOT NULL,
    "closingId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "opening" DECIMAL(16,2) NOT NULL,
    "expected" DECIMAL(16,2) NOT NULL,
    "counted" DECIMAL(16,2) NOT NULL,
    "difference" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "ShiftClosingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosBill" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tillId" UUID NOT NULL,
    "shiftId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" "PosBillKind" NOT NULL,
    "returnOfId" UUID,
    "exchangeId" UUID,
    "customerId" UUID NOT NULL,
    "cashierId" UUID NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "PosBillStatus" NOT NULL DEFAULT 'completed',
    "grossAmount" DECIMAL(16,2) NOT NULL,
    "discountAmount" DECIMAL(16,2) NOT NULL,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "cgst" DECIMAL(16,2) NOT NULL,
    "sgst" DECIMAL(16,2) NOT NULL,
    "igst" DECIMAL(16,2) NOT NULL,
    "roundingAdjustment" DECIMAL(16,2) NOT NULL,
    "total" DECIMAL(16,2) NOT NULL,
    "paidAmount" DECIMAL(16,2) NOT NULL,
    "changeAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "costValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "couponId" UUID,
    "billDiscount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "checkFlags" TEXT[],
    "gstProvisional" BOOLEAN NOT NULL DEFAULT true,
    "returnReason" TEXT,
    "approvedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "reprints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosBillLine" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "itemId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "basicQuantity" DECIMAL(18,3) NOT NULL,
    "barcode" TEXT,
    "batchId" UUID,
    "serialNumbers" TEXT[],
    "mrp" DECIMAL(14,2),
    "listPrice" DECIMAL(16,4) NOT NULL,
    "price" DECIMAL(16,4) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "offerDiscount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "offerId" UUID,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "gstRate" DECIMAL(5,2) NOT NULL,
    "taxableAmount" DECIMAL(16,2) NOT NULL,
    "cgst" DECIMAL(16,2) NOT NULL,
    "sgst" DECIMAL(16,2) NOT NULL,
    "igst" DECIMAL(16,2) NOT NULL,
    "lineTotal" DECIMAL(16,2) NOT NULL,
    "returnOfLineId" UUID,
    "returnedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "approvedById" UUID,
    "costValue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "accountRole" TEXT NOT NULL DEFAULT 'sales',

    CONSTRAINT "PosBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosPayment" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reference" TEXT,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "targetIds" UUID[],
    "value" DECIMAL(16,4),
    "buyQuantity" DECIMAL(18,3),
    "freeQuantity" DECIMAL(18,3),
    "minQuantity" DECIMAL(18,3),
    "minAmount" DECIMAL(16,2),
    "storeIds" UUID[],
    "customerGroupId" UUID,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "couponOnly" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "offerId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "customerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosSettings" (
    "companyId" UUID NOT NULL,
    "cashDifferenceApprovalAmount" DECIMAL(16,2) NOT NULL DEFAULT 100,
    "printReceiptCopies" INTEGER NOT NULL DEFAULT 1,
    "liveAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PosSettings_pkey" PRIMARY KEY ("companyId")
);

-- CreateIndex
CREATE INDEX "GstRate_hsnCode_idx" ON "GstRate"("hsnCode");

-- CreateIndex
CREATE UNIQUE INDEX "GstRate_hsnCode_effectiveFrom_key" ON "GstRate"("hsnCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_companyId_code_key" ON "PaymentMethod"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Till_companyId_code_key" ON "Till"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TillDevice_tokenHash_key" ON "TillDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "Shift_tillId_status_idx" ON "Shift"("tillId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_tillId_clientId_key" ON "Shift"("tillId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_shiftId_clientId_key" ON "CashMovement"("shiftId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftClosing_shiftId_key" ON "ShiftClosing"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "PosBill_number_key" ON "PosBill"("number");

-- CreateIndex
CREATE INDEX "PosBill_shiftId_idx" ON "PosBill"("shiftId");

-- CreateIndex
CREATE INDEX "PosBill_companyId_businessDate_idx" ON "PosBill"("companyId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "PosBill_tillId_clientId_kind_key" ON "PosBill"("tillId", "clientId", "kind");

-- CreateIndex
CREATE INDEX "PosBillLine_billId_idx" ON "PosBillLine"("billId");

-- CreateIndex
CREATE INDEX "PosBillLine_itemId_idx" ON "PosBillLine"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_companyId_code_key" ON "Offer"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_companyId_code_key" ON "Coupon"("companyId", "code");

-- AddForeignKey
ALTER TABLE "Till" ADD CONSTRAINT "Till_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillPaymentMethod" ADD CONSTRAINT "TillPaymentMethod_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "Till"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillPaymentMethod" ADD CONSTRAINT "TillPaymentMethod_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TillDevice" ADD CONSTRAINT "TillDevice_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "Till"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "Till"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCash" ADD CONSTRAINT "ShiftCash_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftClosing" ADD CONSTRAINT "ShiftClosing_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftClosingLine" ADD CONSTRAINT "ShiftClosingLine_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "ShiftClosing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBill" ADD CONSTRAINT "PosBill_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "Till"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBill" ADD CONSTRAINT "PosBill_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBill" ADD CONSTRAINT "PosBill_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "PosBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBillLine" ADD CONSTRAINT "PosBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PosBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosBillLine" ADD CONSTRAINT "PosBillLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "PosBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permission keys for the system roles (plan 06 §3; decision 70: cashiers never see cost).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'pos.sell'), ('owner_admin', 'pos.return'), ('owner_admin', 'pos.approve'), ('owner_admin', 'pos.close'),
  ('owner_admin', 'pos.shift.manage'), ('owner_admin', 'pos.setup'), ('owner_admin', 'pos.reports'), ('owner_admin', 'offers.manage'),
  ('owner_admin', 'gst_rates.manage'), ('owner_admin', 'gst_rates.approve'),
  ('accountant', 'pos.reports'), ('accountant', 'pos.setup'), ('accountant', 'gst_rates.manage'), ('accountant', 'gst_rates.approve'),
  ('store_manager', 'pos.sell'), ('store_manager', 'pos.return'), ('store_manager', 'pos.approve'), ('store_manager', 'pos.close'),
  ('store_manager', 'pos.shift.manage'), ('store_manager', 'pos.reports'), ('store_manager', 'offers.manage'),
  ('cashier', 'pos.sell'), ('cashier', 'pos.return'), ('cashier', 'pos.close'),
  ('viewer_auditor', 'pos.reports')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
