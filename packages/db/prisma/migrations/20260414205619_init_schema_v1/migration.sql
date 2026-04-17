-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BackfillStatus" AS ENUM ('NOT_STARTED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PENDING', 'CANCELLED', 'EXPIRED', 'DECLINED', 'FROZEN');

-- CreateEnum
CREATE TYPE "SyncRunType" AS ENUM ('SHOP_BOOTSTRAP', 'PRODUCT_BACKFILL', 'ORDER_BACKFILL', 'WEBHOOK_RECONCILIATION', 'DAILY_REBUILD', 'WEEKLY_REBUILD');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "CostSourceType" AS ENUM ('MANUAL', 'CSV', 'CATEGORY_DEFAULT', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "DataCompletenessLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'READ', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('ALERT_EXPLANATION', 'ALERT_ACTION', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('QUEUED', 'GENERATED', 'FAILED', 'FALLBACK');

-- CreateEnum
CREATE TYPE "FeedbackValue" AS ENUM ('USEFUL', 'NOT_USEFUL', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "shopName" TEXT,
    "email" TEXT,
    "primaryDomain" TEXT,
    "countryCode" TEXT,
    "currencyCode" TEXT,
    "ianaTimezone" TEXT,
    "planName" TEXT,
    "currentPlan" "BillingPlan" NOT NULL DEFAULT 'FREE',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "backfillStatus" "BackfillStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyChargeId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "interval" TEXT,
    "priceAmount" DECIMAL(12,2),
    "currencyCode" TEXT,
    "trialDays" INTEGER,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "test" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "shopifyChargeId" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "topic" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "apiVersion" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "runType" "SyncRunType" NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "recordsTotal" INTEGER,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "status" TEXT,
    "tags" JSONB,
    "createdAtShopify" TIMESTAMP(3),
    "updatedAtShopify" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "priceAmount" DECIMAL(12,2),
    "compareAtAmount" DECIMAL(12,2),
    "inventoryQuantity" INTEGER,
    "weightValue" DECIMAL(10,3),
    "weightUnit" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT,
    "processedAt" TIMESTAMP(3),
    "orderCreatedAtShopify" TIMESTAMP(3),
    "orderUpdatedAtShopify" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL,
    "presentmentCurrencyCode" TEXT,
    "subtotalAmount" DECIMAL(14,2),
    "totalDiscountAmount" DECIMAL(14,2),
    "totalRefundAmount" DECIMAL(14,2),
    "totalTaxAmount" DECIMAL(14,2),
    "totalShippingRevenueAmount" DECIMAL(14,2),
    "shippingCostEstimateAmount" DECIMAL(14,2),
    "transactionFeeEstimateAmount" DECIMAL(14,2),
    "grossProfitBeforeAdSpend" DECIMAL(14,2),
    "salesChannel" TEXT,
    "sourceName" TEXT,
    "customerCountryCode" TEXT,
    "dataCompletenessLevel" "DataCompletenessLevel" NOT NULL DEFAULT 'LOW',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "shopifyLineItemId" TEXT NOT NULL,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "subtotalAmount" DECIMAL(14,2),
    "discountAmount" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "refundedAmount" DECIMAL(14,2),
    "productCostAmount" DECIMAL(14,2),
    "grossProfitAmount" DECIMAL(14,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "totalRefundAmount" DECIMAL(14,2),
    "currencyCode" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundLineItem" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "orderLineItemId" TEXT,
    "shopifyRefundLineId" TEXT,
    "quantity" INTEGER,
    "subtotalAmount" DECIMAL(14,2),
    "taxAmount" DECIMAL(14,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderShippingLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shippingCode" TEXT,
    "title" TEXT,
    "revenueAmount" DECIMAL(14,2),
    "costEstimate" DECIMAL(14,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderShippingLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDiscount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "shopifyTargetId" TEXT,
    "title" TEXT,
    "allocationMethod" TEXT,
    "targetType" TEXT,
    "amount" DECIMAL(14,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTaxLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "title" TEXT,
    "rate" DECIMAL(8,5),
    "amount" DECIMAL(14,2),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTaxLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTransactionRaw" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyTransactionId" TEXT,
    "kind" TEXT,
    "gateway" TEXT,
    "status" TEXT,
    "amount" DECIMAL(14,2),
    "currencyCode" TEXT,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransactionRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantCost" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT,
    "sku" TEXT,
    "sourceType" "CostSourceType" NOT NULL,
    "costAmount" DECIMAL(14,4) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "confidenceLevel" "DataCompletenessLevel" NOT NULL DEFAULT 'MEDIUM',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "importedBatchKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryCostProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "defaultCostRate" DECIMAL(6,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryCostProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionFeeProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "percentageRate" DECIMAL(6,4) NOT NULL,
    "fixedFeeAmount" DECIMAL(12,4) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionFeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpendManualEntry" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "channelKey" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSpendManualEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "conversionRate" DECIMAL(18,8) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyShopMetric" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metricDate" TIMESTAMP(3) NOT NULL,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "grossSalesAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingRevenueAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingCostEstimateAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transactionFeeEstimateAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "productCostAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossProfitBeforeAdSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossMarginRate" DECIMAL(8,5),
    "averageOrderShippingCost" DECIMAL(14,2),
    "refundRate" DECIMAL(8,5),
    "discountRate" DECIMAL(8,5),
    "completenessLevel" "DataCompletenessLevel" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyShopMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyChannelMetric" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "metricDate" TIMESTAMP(3) NOT NULL,
    "channelKey" TEXT NOT NULL,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "grossSalesAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossProfitBeforeAdSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossMarginRate" DECIMAL(8,5),
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shippingCostAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyChannelMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySkuMetric" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "variantId" TEXT,
    "metricDate" TIMESTAMP(3) NOT NULL,
    "sku" TEXT,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "quantitySold" INTEGER NOT NULL DEFAULT 0,
    "grossSalesAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "productCostAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossProfitBeforeAdSpend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossMarginRate" DECIMAL(8,5),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySkuMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitHealthScore" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scoreDate" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "levelLabel" TEXT NOT NULL,
    "deductionsPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitHealthScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataCompletenessSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "level" "DataCompletenessLevel" NOT NULL,
    "variantCoverageRate" DECIMAL(8,5),
    "orderCoverageRate" DECIMAL(8,5),
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataCompletenessSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertThread" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "threadId" TEXT,
    "alertType" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impactAmount" DECIMAL(14,2),
    "currencyCode" TEXT,
    "confidenceLevel" "DataCompletenessLevel" NOT NULL DEFAULT 'MEDIUM',
    "completenessLevel" "DataCompletenessLevel" NOT NULL DEFAULT 'LOW',
    "detectedForDate" TIMESTAMP(3) NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "rankScore" DECIMAL(10,4),
    "rulePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertStatusHistory" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "fromStatus" "AlertStatus",
    "toStatus" "AlertStatus" NOT NULL,
    "note" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertFeedback" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "feedback" "FeedbackValue" NOT NULL,
    "note" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiArtifact" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "alertId" TEXT,
    "artifactType" "ArtifactType" NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputJson" JSONB,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'QUEUED',
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "generatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "aiArtifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportExport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "exportFormat" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "Shop"("shopifyShopId");

-- CreateIndex
CREATE INDEX "Shop_isActive_idx" ON "Shop"("isActive");

-- CreateIndex
CREATE INDEX "Shop_currentPlan_idx" ON "Shop"("currentPlan");

-- CreateIndex
CREATE INDEX "Shop_backfillStatus_idx" ON "Shop"("backfillStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopifyChargeId_key" ON "BillingSubscription"("shopifyChargeId");

-- CreateIndex
CREATE INDEX "BillingSubscription_shopId_status_idx" ON "BillingSubscription"("shopId", "status");

-- CreateIndex
CREATE INDEX "BillingEvent_shopId_eventType_idx" ON "BillingEvent"("shopId", "eventType");

-- CreateIndex
CREATE INDEX "BillingEvent_shopifyChargeId_idx" ON "BillingEvent"("shopifyChargeId");

-- CreateIndex
CREATE INDEX "WebhookEvent_shopId_topic_idx" ON "WebhookEvent"("shopId", "topic");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_topic_webhookId_key" ON "WebhookEvent"("topic", "webhookId");

-- CreateIndex
CREATE INDEX "SyncRun_shopId_runType_status_idx" ON "SyncRun"("shopId", "runType", "status");

-- CreateIndex
CREATE INDEX "SyncRun_createdAt_idx" ON "SyncRun"("createdAt");

-- CreateIndex
CREATE INDEX "Product_shopId_productType_idx" ON "Product"("shopId", "productType");

-- CreateIndex
CREATE INDEX "Product_shopId_status_idx" ON "Product"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopId_shopifyProductId_key" ON "Product"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Variant_shopId_sku_idx" ON "Variant"("shopId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_shopId_shopifyVariantId_key" ON "Variant"("shopId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "Order_shopId_processedAt_idx" ON "Order"("shopId", "processedAt");

-- CreateIndex
CREATE INDEX "Order_shopId_salesChannel_idx" ON "Order"("shopId", "salesChannel");

-- CreateIndex
CREATE INDEX "Order_shopId_customerCountryCode_idx" ON "Order"("shopId", "customerCountryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopId_shopifyOrderId_key" ON "Order"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_variantId_idx" ON "OrderLineItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderLineItem_sku_idx" ON "OrderLineItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_orderId_shopifyLineItemId_key" ON "OrderLineItem"("orderId", "shopifyLineItemId");

-- CreateIndex
CREATE INDEX "Refund_shopId_refundedAt_idx" ON "Refund"("shopId", "refundedAt");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_shopId_shopifyRefundId_key" ON "Refund"("shopId", "shopifyRefundId");

-- CreateIndex
CREATE INDEX "RefundLineItem_refundId_idx" ON "RefundLineItem"("refundId");

-- CreateIndex
CREATE INDEX "RefundLineItem_orderLineItemId_idx" ON "RefundLineItem"("orderLineItemId");

-- CreateIndex
CREATE INDEX "OrderShippingLine_orderId_idx" ON "OrderShippingLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderDiscount_orderId_idx" ON "OrderDiscount"("orderId");

-- CreateIndex
CREATE INDEX "OrderDiscount_lineItemId_idx" ON "OrderDiscount"("lineItemId");

-- CreateIndex
CREATE INDEX "OrderTaxLine_orderId_idx" ON "OrderTaxLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderTaxLine_lineItemId_idx" ON "OrderTaxLine"("lineItemId");

-- CreateIndex
CREATE INDEX "OrderTransactionRaw_orderId_idx" ON "OrderTransactionRaw"("orderId");

-- CreateIndex
CREATE INDEX "OrderTransactionRaw_shopifyTransactionId_idx" ON "OrderTransactionRaw"("shopifyTransactionId");

-- CreateIndex
CREATE INDEX "VariantCost_shopId_variantId_idx" ON "VariantCost"("shopId", "variantId");

-- CreateIndex
CREATE INDEX "VariantCost_shopId_sku_idx" ON "VariantCost"("shopId", "sku");

-- CreateIndex
CREATE INDEX "VariantCost_shopId_sourceType_idx" ON "VariantCost"("shopId", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryCostProfile_shopId_categoryKey_key" ON "CategoryCostProfile"("shopId", "categoryKey");

-- CreateIndex
CREATE INDEX "TransactionFeeProfile_shopId_isDefault_idx" ON "TransactionFeeProfile"("shopId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendManualEntry_shopId_entryDate_channelKey_key" ON "AdSpendManualEntry"("shopId", "entryDate", "channelKey");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_rateDate_baseCurrency_quoteCurrency_key" ON "FxRate"("rateDate", "baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE INDEX "DailyShopMetric_shopId_metricDate_idx" ON "DailyShopMetric"("shopId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyShopMetric_shopId_metricDate_key" ON "DailyShopMetric"("shopId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyChannelMetric_shopId_metricDate_channelKey_key" ON "DailyChannelMetric"("shopId", "metricDate", "channelKey");

-- CreateIndex
CREATE INDEX "DailySkuMetric_shopId_metricDate_idx" ON "DailySkuMetric"("shopId", "metricDate");

-- CreateIndex
CREATE INDEX "DailySkuMetric_shopId_sku_idx" ON "DailySkuMetric"("shopId", "sku");

-- CreateIndex
CREATE INDEX "DailySkuMetric_variantId_metricDate_idx" ON "DailySkuMetric"("variantId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitHealthScore_shopId_scoreDate_key" ON "ProfitHealthScore"("shopId", "scoreDate");

-- CreateIndex
CREATE UNIQUE INDEX "DataCompletenessSnapshot_shopId_snapshotDate_key" ON "DataCompletenessSnapshot"("shopId", "snapshotDate");

-- CreateIndex
CREATE INDEX "AlertThread_shopId_alertType_entityType_entityKey_idx" ON "AlertThread"("shopId", "alertType", "entityType", "entityKey");

-- CreateIndex
CREATE INDEX "AlertThread_shopId_isOpen_idx" ON "AlertThread"("shopId", "isOpen");

-- CreateIndex
CREATE INDEX "Alert_shopId_status_severity_idx" ON "Alert"("shopId", "status", "severity");

-- CreateIndex
CREATE INDEX "Alert_shopId_detectedForDate_idx" ON "Alert"("shopId", "detectedForDate");

-- CreateIndex
CREATE INDEX "Alert_threadId_idx" ON "Alert"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_shopId_alertType_entityType_entityKey_detectedForDate_key" ON "Alert"("shopId", "alertType", "entityType", "entityKey", "detectedForDate");

-- CreateIndex
CREATE INDEX "AlertStatusHistory_alertId_createdAt_idx" ON "AlertStatusHistory"("alertId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertFeedback_alertId_feedback_idx" ON "AlertFeedback"("alertId", "feedback");

-- CreateIndex
CREATE INDEX "AiArtifact_shopId_artifactType_status_idx" ON "AiArtifact"("shopId", "artifactType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AiArtifact_shopId_artifactType_referenceKey_inputHash_key" ON "AiArtifact"("shopId", "artifactType", "referenceKey", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshot_shopId_reportType_periodStart_periodEnd_key" ON "ReportSnapshot"("shopId", "reportType", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "ReportExport_shopId_reportType_createdAt_idx" ON "ReportExport"("shopId", "reportType", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLineItem" ADD CONSTRAINT "RefundLineItem_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLineItem" ADD CONSTRAINT "RefundLineItem_orderLineItemId_fkey" FOREIGN KEY ("orderLineItemId") REFERENCES "OrderLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderShippingLine" ADD CONSTRAINT "OrderShippingLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDiscount" ADD CONSTRAINT "OrderDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTaxLine" ADD CONSTRAINT "OrderTaxLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTransactionRaw" ADD CONSTRAINT "OrderTransactionRaw_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantCost" ADD CONSTRAINT "VariantCost_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantCost" ADD CONSTRAINT "VariantCost_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryCostProfile" ADD CONSTRAINT "CategoryCostProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionFeeProfile" ADD CONSTRAINT "TransactionFeeProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSpendManualEntry" ADD CONSTRAINT "AdSpendManualEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyShopMetric" ADD CONSTRAINT "DailyShopMetric_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyChannelMetric" ADD CONSTRAINT "DailyChannelMetric_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySkuMetric" ADD CONSTRAINT "DailySkuMetric_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySkuMetric" ADD CONSTRAINT "DailySkuMetric_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitHealthScore" ADD CONSTRAINT "ProfitHealthScore_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataCompletenessSnapshot" ADD CONSTRAINT "DataCompletenessSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertThread" ADD CONSTRAINT "AlertThread_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AlertThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertStatusHistory" ADD CONSTRAINT "AlertStatusHistory_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertFeedback" ADD CONSTRAINT "AlertFeedback_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportExport" ADD CONSTRAINT "ReportExport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

