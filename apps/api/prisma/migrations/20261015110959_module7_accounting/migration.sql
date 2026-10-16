-- CreateEnum
CREATE TYPE "AccountFamily" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "AccountingDocStatus" AS ENUM ('draft', 'posted', 'cancelled');

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'on_account';

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "ledgerEntryId" UUID;

-- AlterTable
ALTER TABLE "StockLedgerEntry" ADD COLUMN     "ledgerHeld" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "postedValue" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "parentId" UUID,
    "number" TEXT,
    "name" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "family" "AccountFamily" NOT NULL,
    "kind" TEXT,
    "storeId" UUID,
    "balanceMustBe" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountDefault" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "AccountDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSettings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "chartApprovedAt" TIMESTAMP(3),
    "chartApprovedById" UUID,
    "chartApprovalNote" TEXT,
    "ageingBands" INTEGER[] DEFAULT ARRAY[30, 60, 90, 120]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "financialYearId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "documentNumber" TEXT,
    "storeId" UUID,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "cancelsId" UUID,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerLine" (
    "id" BIGSERIAL NOT NULL,
    "entryId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID,
    "partyType" TEXT,
    "partyId" UUID,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "itemType" TEXT,
    "itemId" UUID,
    "itemNumber" TEXT,
    "dueDate" DATE,
    "remark" TEXT,

    CONSTRAINT "LedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" UUID NOT NULL,
    "billType" TEXT NOT NULL,
    "billId" UUID NOT NULL,
    "byType" TEXT NOT NULL,
    "byId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "settledOn" DATE NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "undoneAt" TIMESTAMP(3),
    "undoneById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT,
    "kind" TEXT NOT NULL,
    "journalDate" DATE NOT NULL,
    "financialYearId" UUID NOT NULL,
    "reference" TEXT,
    "referenceDate" DATE,
    "clearedOn" DATE,
    "remark" TEXT,
    "status" "AccountingDocStatus" NOT NULL DEFAULT 'draft',
    "ledgerEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "storeId" UUID,
    "partyType" TEXT,
    "partyId" UUID,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "againstType" TEXT,
    "againstId" UUID,
    "remark" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "number" TEXT,
    "kind" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "financialYearId" UUID NOT NULL,
    "storeId" UUID,
    "partyType" TEXT,
    "partyId" UUID,
    "fromAccountId" UUID,
    "toAccountId" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "reference" TEXT,
    "referenceDate" DATE,
    "clearedOn" DATE,
    "remark" TEXT,
    "status" "AccountingDocStatus" NOT NULL DEFAULT 'draft',
    "ledgerEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "billType" TEXT NOT NULL,
    "billId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDeduction" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "remark" TEXT,

    CONSTRAINT "PaymentDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningBill" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" UUID NOT NULL,
    "storeId" UUID,
    "billNumber" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" "AccountingDocStatus" NOT NULL DEFAULT 'posted',
    "ledgerEntryId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "OpeningBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT,
    "branch" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YearEndClosing" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "financialYearId" UUID NOT NULL,
    "closingAccountId" UUID NOT NULL,
    "periodEnd" DATE NOT NULL,
    "remark" TEXT,
    "status" "AccountingDocStatus" NOT NULL DEFAULT 'posted',
    "ledgerEntryId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "YearEndClosing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_companyId_parentId_idx" ON "Account"("companyId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_number_key" ON "Account"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Account_companyId_systemKey_key" ON "Account"("companyId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDefault_companyId_role_key" ON "AccountDefault"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSettings_companyId_key" ON "AccountingSettings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_cancelsId_key" ON "LedgerEntry"("cancelsId");

-- CreateIndex
CREATE INDEX "LedgerEntry_companyId_entryDate_idx" ON "LedgerEntry"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_documentType_documentId_idx" ON "LedgerEntry"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "LedgerLine_accountId_entryDate_idx" ON "LedgerLine"("accountId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerLine_companyId_entryDate_idx" ON "LedgerLine"("companyId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerLine_partyType_partyId_entryDate_idx" ON "LedgerLine"("partyType", "partyId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerLine_itemType_itemId_idx" ON "LedgerLine"("itemType", "itemId");

-- CreateIndex
CREATE INDEX "Settlement_partyType_partyId_idx" ON "Settlement"("partyType", "partyId");

-- CreateIndex
CREATE INDEX "Settlement_billType_billId_idx" ON "Settlement"("billType", "billId");

-- CreateIndex
CREATE INDEX "Settlement_byType_byId_idx" ON "Settlement"("byType", "byId");

-- CreateIndex
CREATE INDEX "Journal_companyId_journalDate_idx" ON "Journal"("companyId", "journalDate");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_companyId_number_key" ON "Journal"("companyId", "number");

-- CreateIndex
CREATE INDEX "Payment_companyId_paymentDate_idx" ON "Payment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_partyType_partyId_idx" ON "Payment"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_number_key" ON "Payment"("companyId", "number");

-- CreateIndex
CREATE INDEX "OpeningBill_partyType_partyId_idx" ON "OpeningBill"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_accountId_key" ON "BankAccount"("accountId");

-- CreateIndex
CREATE INDEX "YearEndClosing_companyId_periodEnd_idx" ON "YearEndClosing"("companyId", "periodEnd");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountDefault" ADD CONSTRAINT "AccountDefault_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_cancelsId_fkey" FOREIGN KEY ("cancelsId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDeduction" ADD CONSTRAINT "PaymentDeduction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Posted ledger entries and lines are never changed or deleted (decision 50,
-- CLAUDE.md rule 4). A mistake is corrected by a reversing entry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be changed or deleted; post a reversing entry instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_guard BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();
CREATE TRIGGER ledger_line_guard BEFORE UPDATE OR DELETE ON "LedgerLine"
  FOR EACH ROW EXECUTE FUNCTION ledger_guard();

-- Every entry balances: checked when the transaction commits, so all lines of an entry are in.
CREATE OR REPLACE FUNCTION ledger_balance_check() RETURNS trigger AS $$
DECLARE
  diff numeric;
BEGIN
  SELECT coalesce(sum("debit"), 0) - coalesce(sum("credit"), 0) INTO diff FROM "LedgerLine" WHERE "entryId" = NEW."entryId";
  IF diff <> 0 THEN
    RAISE EXCEPTION 'Ledger entry % does not balance (difference %)', NEW."entryId", diff;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_line_balanced AFTER INSERT ON "LedgerLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_balance_check();

ALTER TABLE "LedgerLine" ADD CONSTRAINT "LedgerLine_one_side" CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0));

-- Permission keys for the system roles (plan 07 section 8).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'accounts.view'), ('owner_admin', 'accounts.manage'), ('owner_admin', 'accounts.approve_chart'),
  ('owner_admin', 'journals.post'), ('owner_admin', 'payments.post'), ('owner_admin', 'cash.deposit'), ('owner_admin', 'books.lock'),
  ('accountant', 'accounts.view'), ('accountant', 'accounts.manage'), ('accountant', 'journals.post'), ('accountant', 'payments.post'),
  ('accountant', 'cash.deposit'), ('accountant', 'books.lock'),
  ('store_manager', 'accounts.view'), ('store_manager', 'cash.deposit'),
  ('viewer_auditor', 'accounts.view')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
