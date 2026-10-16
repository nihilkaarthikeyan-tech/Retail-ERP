-- CreateTable
CREATE TABLE "PosSyncProblem" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "tillId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSyncProblem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PosSyncProblem_tillId_clientId_kind_key" ON "PosSyncProblem"("tillId", "clientId", "kind");
