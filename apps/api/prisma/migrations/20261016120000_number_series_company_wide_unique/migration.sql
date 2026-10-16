-- Copyright (c) 2026, Rademics. All rights reserved.
-- One company-wide number series per document kind. The existing unique rule
-- on (companyId, documentKind, storeId) never applies when storeId is null,
-- because PostgreSQL treats nulls as different, so two requests creating the
-- defaults at the same moment could each add a company-wide series.

-- Remove extra company-wide series left by such a race. Only copies that never
-- issued a number are removed: one is removed when another copy has issued
-- numbers, or when an older copy exists. If two copies have both issued
-- numbers, the index below fails and the rows must be reviewed by hand.
DELETE FROM "NumberSeries" ns
WHERE ns."storeId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "NumberSeriesCounter" c WHERE c."numberSeriesId" = ns."id")
  AND EXISTS (
    SELECT 1 FROM "NumberSeries" other
    WHERE other."storeId" IS NULL
      AND other."companyId" = ns."companyId"
      AND other."documentKind" = ns."documentKind"
      AND other."id" <> ns."id"
      AND (
        EXISTS (SELECT 1 FROM "NumberSeriesCounter" c WHERE c."numberSeriesId" = other."id")
        OR (other."createdAt", other."id") < (ns."createdAt", ns."id")
      )
  );

-- CreateIndex
CREATE UNIQUE INDEX "NumberSeries_companyId_documentKind_company_wide_key" ON "NumberSeries"("companyId", "documentKind") WHERE ("storeId" IS NULL);
