import assert from "node:assert/strict";
import test from "node:test";
import { DataCompletenessLevel } from "@prisma/client";
import { evaluateAlertCandidates } from "./alert-engine";
import type { DailyMetricsBundle } from "./metrics-core";

test("evaluateAlertCandidates emits expanded profitability signals across shop, sku, region, channel, and source scopes", () => {
  const bundle: DailyMetricsBundle = {
    shopMetrics: [
      {
        metricDate: new Date("2026-04-14T00:00:00.000Z"),
        ordersCount: 3,
        grossSalesAmount: 100,
        discountAmount: 8,
        refundAmount: 5,
        shippingRevenueAmount: 0,
        shippingCostEstimateAmount: 12,
        transactionFeeEstimateAmount: 3,
        productCostAmount: 60,
        grossProfitBeforeAdSpend: 24,
        grossMarginRate: 0.24,
        averageOrderShippingCost: 4,
        refundRate: 0.05,
        discountRate: 0.08,
        completenessLevel: DataCompletenessLevel.HIGH,
      },
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        ordersCount: 3,
        grossSalesAmount: 200,
        discountAmount: 36,
        refundAmount: 30,
        shippingRevenueAmount: 0,
        shippingCostEstimateAmount: 30,
        transactionFeeEstimateAmount: 6,
        productCostAmount: 155,
        grossProfitBeforeAdSpend: 9,
        grossMarginRate: 0.045,
        averageOrderShippingCost: 10,
        refundRate: 0.15,
        discountRate: 0.18,
        completenessLevel: DataCompletenessLevel.LOW,
      },
    ],
    channelMetrics: [
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        channelKey: "online_store",
        ordersCount: 2,
        grossSalesAmount: 140,
        grossProfitBeforeAdSpend: 8,
        grossMarginRate: 0.05714,
        refundAmount: 0,
        shippingCostAmount: 18,
      },
    ],
    skuMetrics: [
      {
        metricDate: new Date("2026-04-14T00:00:00.000Z"),
        variantId: "variant-1",
        sku: "PG-LOSS-001",
        ordersCount: 2,
        quantitySold: 2,
        grossSalesAmount: 100,
        discountAmount: 12,
        refundAmount: 0,
        productCostAmount: 70,
        grossProfitBeforeAdSpend: 24,
        grossMarginRate: 0.24,
      },
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        variantId: "variant-1",
        sku: "PG-LOSS-001",
        ordersCount: 2,
        quantitySold: 4,
        grossSalesAmount: 80,
        discountAmount: 22,
        refundAmount: 0,
        productCostAmount: 90,
        grossProfitBeforeAdSpend: -10,
        grossMarginRate: -0.125,
      },
      {
        metricDate: new Date("2026-04-14T00:00:00.000Z"),
        variantId: "variant-2",
        sku: "PG-LOWMIX-001",
        ordersCount: 1,
        quantitySold: 1,
        grossSalesAmount: 20,
        discountAmount: 0,
        refundAmount: 0,
        productCostAmount: 12,
        grossProfitBeforeAdSpend: 4,
        grossMarginRate: 0.2,
      },
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        variantId: "variant-2",
        sku: "PG-LOWMIX-001",
        ordersCount: 2,
        quantitySold: 5,
        grossSalesAmount: 120,
        discountAmount: 10,
        refundAmount: 0,
        productCostAmount: 110,
        grossProfitBeforeAdSpend: 5,
        grossMarginRate: 0.04167,
      },
    ],
    regionMetrics: [
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        countryCode: "US",
        ordersCount: 2,
        grossSalesAmount: 120,
        refundAmount: 18,
        shippingCostAmount: 24,
        refundRate: 0.15,
        averageOrderShippingCost: 12,
      },
    ],
    sourceMetrics: [
      {
        metricDate: new Date("2026-04-15T00:00:00.000Z"),
        sourceKey: "campaign_alpha",
        ordersCount: 2,
        grossSalesAmount: 100,
        grossProfitBeforeAdSpend: 7,
        grossMarginRate: 0.07,
      },
    ],
    completenessSnapshots: [
      {
        snapshotDate: new Date("2026-04-14T00:00:00.000Z"),
        level: DataCompletenessLevel.HIGH,
        variantCoverageRate: 0.95,
        orderCoverageRate: 0.95,
        payload: {
          totalOrders: 3,
          coveredOrders: 3,
        },
      },
      {
        snapshotDate: new Date("2026-04-15T00:00:00.000Z"),
        level: DataCompletenessLevel.LOW,
        variantCoverageRate: 0.4,
        orderCoverageRate: 0.5,
        payload: {
          totalOrders: 3,
          coveredOrders: 1,
        },
      },
    ],
    healthScores: [],
    summary: {
      datesProcessed: 2,
      ordersProcessed: 6,
      lineItemsProcessed: 8,
      timeZone: "UTC",
    },
  };

  const candidates = evaluateAlertCandidates({
    bundle,
    currencyCode: "USD",
  });

  assert.ok(candidates.length >= 12);
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_LOW_MARGIN"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_HIGH_REFUND_RATE"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_HIGH_DISCOUNT_RATE"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_HIGH_SHIPPING_COST"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_GMV_UP_MARGIN_FLAT"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SHOP_LOW_COMPLETENESS"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "CHANNEL_LOW_MARGIN"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "REGION_HIGH_REFUND_RATE"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "REGION_HIGH_SHIPPING_COST"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SKU_NEGATIVE_MARGIN"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SKU_MARGIN_DROP"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SKU_DEEP_DISCOUNT"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "SOURCE_LOW_MARGIN"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "ORDER_MIX_LOW_MARGIN"));
  assert.ok(candidates.some((candidate) => candidate.alertType === "PROMO_LOW_MARGIN"));
  assert.equal(candidates.find((candidate) => candidate.alertType === "SHOP_LOW_MARGIN")?.severity, "CRITICAL");
  assert.equal(candidates.find((candidate) => candidate.alertType === "SHOP_HIGH_REFUND_RATE")?.impactAmount, 30);
  assert.equal(candidates.find((candidate) => candidate.alertType === "SKU_NEGATIVE_MARGIN")?.entityKey, "variant-1");
});
