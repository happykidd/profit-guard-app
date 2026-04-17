-- CreateEnum
CREATE TYPE "CostImportType" AS ENUM ('DIRECT_COSTS', 'FALLBACK_RULES');

-- CreateEnum
CREATE TYPE "CostImportMode" AS ENUM ('PREVIEW', 'UPSERT', 'REPLACE');

-- CreateEnum
CREATE TYPE "CostImportStatus" AS ENUM ('PREVIEW', 'APPLIED', 'ROLLED_BACK', 'FAILED');

-- AlterTable
ALTER TABLE "CategoryCostProfile" ADD COLUMN     "importedBatchKey" TEXT;

-- CreateTable
CREATE TABLE "CostImportBatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "importType" "CostImportType" NOT NULL,
    "mode" "CostImportMode" NOT NULL,
    "status" "CostImportStatus" NOT NULL DEFAULT 'APPLIED',
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT,
    "summary" JSONB,
    "rollbackSummary" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostImportBatch_shopId_importType_createdAt_idx" ON "CostImportBatch"("shopId", "importType", "createdAt");

-- CreateIndex
CREATE INDEX "CostImportBatch_shopId_status_createdAt_idx" ON "CostImportBatch"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CategoryCostProfile_shopId_importedBatchKey_idx" ON "CategoryCostProfile"("shopId", "importedBatchKey");

-- AddForeignKey
ALTER TABLE "CostImportBatch" ADD CONSTRAINT "CostImportBatch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
