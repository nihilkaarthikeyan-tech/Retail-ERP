-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 11 A8: supplier bills for goods can be made to need an order or a receipt (off by default).
-- AlterTable
ALTER TABLE "PurchaseSettings" ADD COLUMN     "billNeedsOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "billNeedsReceipt" BOOLEAN NOT NULL DEFAULT false;
