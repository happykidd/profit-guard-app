-- CreateEnum
CREATE TYPE "DigestDeliveryStatus" AS ENUM ('PREPARED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "DigestDelivery" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "reportSnapshotId" TEXT,
    "reportType" "ReportType" NOT NULL,
    "deliveryChannel" TEXT NOT NULL DEFAULT 'EMAIL',
    "exportFormat" TEXT NOT NULL DEFAULT 'email_text',
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "DigestDeliveryStatus" NOT NULL DEFAULT 'PREPARED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigestDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DigestDelivery_shopId_status_createdAt_idx" ON "DigestDelivery"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DigestDelivery_shopId_reportType_createdAt_idx" ON "DigestDelivery"("shopId", "reportType", "createdAt");

-- CreateIndex
CREATE INDEX "DigestDelivery_reportSnapshotId_idx" ON "DigestDelivery"("reportSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestDelivery_shopId_reportSnapshotId_recipientEmail_expor_key" ON "DigestDelivery"("shopId", "reportSnapshotId", "recipientEmail", "exportFormat");

-- AddForeignKey
ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigestDelivery" ADD CONSTRAINT "DigestDelivery_reportSnapshotId_fkey" FOREIGN KEY ("reportSnapshotId") REFERENCES "ReportSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
