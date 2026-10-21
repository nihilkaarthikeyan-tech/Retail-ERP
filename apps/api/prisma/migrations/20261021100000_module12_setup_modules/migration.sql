-- Copyright (c) 2026, Rademics. All rights reserved.
-- Plan 12: shop type, checklist, optional modules per company, guided setup progress.
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "checklistHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shopType" TEXT;

-- CreateTable
CREATE TABLE "CompanyModule" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "CompanyModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupProgress" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "step" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyModule_companyId_moduleKey_key" ON "CompanyModule"("companyId", "moduleKey");

