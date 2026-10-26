-- Owner, 26 October 2026: "Forgot password?" and "Confirm your email" links.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Everyone already using the system counts as confirmed, so nobody is asked again.
UPDATE "User" SET "emailVerifiedAt" = "createdAt";

-- CreateTable
CREATE TABLE "UserToken" (
    "companyId" UUID NOT NULL DEFAULT (NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid,
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserToken_userId_purpose_idx" ON "UserToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "UserToken_companyId_idx" ON "UserToken"("companyId");

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Plan 14: each shop sees only its own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON "UserToken" TO retail_erp_app;
ALTER TABLE "UserToken" ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_only ON "UserToken"
  USING ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK ("companyId" = nullif(current_setting('app.company_id', true), '')::uuid);
