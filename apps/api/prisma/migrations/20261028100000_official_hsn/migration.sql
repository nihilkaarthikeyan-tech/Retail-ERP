-- Copyright (c) 2026, Rademics. All rights reserved.
-- Owner, 28 October 2026: the official HSN / SAC list from the GST portal, the same for every
-- shop, and which version of each official list is loaded.

-- CreateTable
CREATE TABLE "OfficialHsnCode" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isService" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OfficialHsnCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ReferenceDataVersion" (
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceDataVersion_pkey" PRIMARY KEY ("key")
);

-- Not any one shop's: every shop may read the official list, none may change it (only the
-- system client loads it); the version table is for the system client only.
ALTER TABLE "OfficialHsnCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY official_hsn_read ON "OfficialHsnCode" FOR SELECT USING (true);
ALTER TABLE "ReferenceDataVersion" ENABLE ROW LEVEL SECURITY;
