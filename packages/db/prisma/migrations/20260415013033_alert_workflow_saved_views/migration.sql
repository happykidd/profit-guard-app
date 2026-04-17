-- AlterTable
ALTER TABLE "AlertThread" ADD COLUMN     "ownerAssignedAt" TIMESTAMP(3),
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerName" TEXT,
ADD COLUMN     "workflowNote" TEXT;

-- CreateTable
CREATE TABLE "AlertSavedView" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "search" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlertSavedView_shopId_updatedAt_idx" ON "AlertSavedView"("shopId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertSavedView_shopId_name_key" ON "AlertSavedView"("shopId", "name");

-- AddForeignKey
ALTER TABLE "AlertSavedView" ADD CONSTRAINT "AlertSavedView_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
