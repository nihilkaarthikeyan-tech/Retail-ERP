-- Copyright (c) 2026, Rademics. All rights reserved.
-- One company-wide number series per document kind. The existing unique rule
-- on (companyId, documentKind, storeId) never applies when storeId is null,
-- because PostgreSQL treats nulls as different, so two requests creating the
-- defaults at the same moment could each add a company-wide series.

-- Remove extra company-wide series left by such a race, keeping the oldest.
-- Only copies that never issued a number are removed; if a copy has issued
-- numbers, the index below fails and the rows must be reviewed by hand.
DELETE FROM "NumberSeries" ns
WHERE ns."storeId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "NumberSeriesCounter" c WHERE c."numberSeriesId" = ns."id")
  AND EXISTS (
    SELECT 1 FROM "NumberSeries" older
    WHERE older."storeId" IS NULL
      AND older."companyId" = ns."companyId"
      AND older."documentKind" = ns."documentKind"
      AND (older."createdAt", older."id") < (ns."createdAt", ns."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_companyId_documentKind_company_wide_key" ON "NumberSeries"("companyId", "documentKind") WHERE ("storeId" IS NULL);
