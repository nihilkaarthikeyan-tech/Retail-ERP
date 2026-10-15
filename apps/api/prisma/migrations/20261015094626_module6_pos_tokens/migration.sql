-- CreateTable
CREATE TABLE "PosApproval" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tillId" UUID NOT NULL,
    "managerId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosCashierToken" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tillId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCashierToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosApproval_tokenHash_key" ON "PosApproval"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PosCashierToken_tokenHash_key" ON "PosCashierToken"("tokenHash");
