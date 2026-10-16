-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "goLiveById" UUID,
ADD COLUMN     "goLiveDate" DATE;

-- CreateTable
CREATE TABLE "PrintSettings" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "paperSize" TEXT NOT NULL DEFAULT 'A4',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "storeLetterhead" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PrintSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardTerms" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "usedFor" TEXT NOT NULL,
    "defaultFor" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "StandardTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelTemplate" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sizeKey" TEXT NOT NULL,
    "width" DECIMAL(6,1) NOT NULL,
    "height" DECIMAL(6,1) NOT NULL,
    "media" TEXT NOT NULL,
    "fields" TEXT[],
    "fontSize" INTEGER NOT NULL DEFAULT 8,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LabelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "changed" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" BIGSERIAL NOT NULL,
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "recordKey" TEXT,
    "recordId" TEXT,
    "message" TEXT,
    "data" JSONB NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialClearing" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" UUID,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TrialClearing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintSettings_companyId_key" ON "PrintSettings"("companyId");

-- CreateIndex
CREATE INDEX "ImportJob_companyId_createdAt_idx" ON "ImportJob"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_rowNumber_idx" ON "ImportRow"("jobId", "rowNumber");

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission keys for the system roles (plan 10 section 7).
INSERT INTO "RolePermission" ("roleId", "permissionKey")
SELECT r."id", p."key"
FROM "Role" r
JOIN (VALUES
  ('owner_admin', 'print.settings'), ('owner_admin', 'labels.print'), ('owner_admin', 'import.masters'), ('owner_admin', 'import.opening'),
  ('owner_admin', 'export.masters'), ('owner_admin', 'golive.manage'),
  ('accountant', 'import.opening'), ('accountant', 'export.masters'),
  ('store_manager', 'labels.print'), ('store_manager', 'export.masters'),
  ('stock_receiving', 'labels.print'),
  ('viewer_auditor', 'export.masters')
) AS p("code", "key") ON p."code" = r."code"
ON CONFLICT DO NOTHING;
