-- CreateEnum
CREATE TYPE "ComplianceRequestStatus" AS ENUM ('RECEIVED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ComplianceRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "apiVersion" TEXT,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "requestIdentifier" TEXT,
    "customerShopifyId" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "orderIdentifiers" JSONB,
    "payload" JSONB NOT NULL,
    "resultPayload" JSONB,
    "status" "ComplianceRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceRequest_shopId_topic_createdAt_idx" ON "ComplianceRequest"("shopId", "topic", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceRequest_shopDomain_topic_createdAt_idx" ON "ComplianceRequest"("shopDomain", "topic", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRequest_topic_webhookId_key" ON "ComplianceRequest"("topic", "webhookId");

-- AddForeignKey
ALTER TABLE "ComplianceRequest" ADD CONSTRAINT "ComplianceRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
