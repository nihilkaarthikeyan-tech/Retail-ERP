-- Copyright (c) 2026, Rademics. All rights reserved.
-- Owner decisions of 28 October 2026 (docs/decisions.md, L3, L6, L12).

-- L6 and L12: starting values for new items, filled in by the shop-type templates.
ALTER TABLE "CatalogueSettings" ADD COLUMN "newItemMaxDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "CatalogueSettings" ADD COLUMN "newItemAutoNumberBatches" BOOLEAN NOT NULL DEFAULT true;

-- L3: a markdown can be withdrawn before it starts or ended early.
ALTER TABLE "Markdown" ADD COLUMN "stoppedOn" DATE;
ALTER TABLE "Markdown" ADD COLUMN "stoppedById" UUID;
ALTER TABLE "Markdown" ADD COLUMN "stoppedReason" TEXT;
