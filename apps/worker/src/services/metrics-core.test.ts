import assert from "node:assert/strict";
import test from "node:test";
import { DataCompletenessLevel } from "@prisma/client";
import {
  assessCompletenessLevel,
  buildDailyMetricsBundle,
  calculateHealthScore,
} from "./metrics-core";

test("assessCompletenessLevel returns HIGH, MEDIUM, LOW using coverage thresholds", () => {
  const high = assessCompletenessLevel({
    totalOrders: 10,
    coveredOrders: 9,
    totalLineItems: 20,
    coveredLineItems: 19,
  });
  const medium = assessCompletenessLevel({
    totalOrders: 10,
    coveredOrders: 5,
    totalLineItems: 20,
    coveredLineItems: 13,
  });
  const low = assessCompletenessLevel({
    totalOrders: 10,
    coveredOrders: 4,
    totalLineItems: 20,
    coveredLineItems: 10,
  });

  assert.equal(high.level, DataCompletenessLevel.HIGH);
  assert.equal(medium.level, DataCompletenessLevel.MEDIUM);
  assert.equal(low.level, DataCompletenessLevel.LOW);
});

test("calculateHealthScore applies deductions for weak margin, refunds, discounts, and completeness", () => {
  const score = calculateHealthScore({
    ordersCount: 2,
    grossMarginRate: 0.08,
    refundRate: 0.16,
    discountRate: 0.28,
    completenessLevel: DataCompletenessLevel.LOW,
  });

  assert.equal(score.score, 2);
  assert.equal(score.levelLabel, "Critical");
  assert.equal(score.deductionsPayload.deductions.length, 5);
});

test("buildDailyMetricsBundle aggregates shop, channel, sku, completeness, and health outputs", () => {
  const bundle = buildDailyMetricsBundle(
    [
      {
        orderId: "order-1",
        processedAt: new Date("2026-04-14T10:00:00.000Z"),
        salesChannel: "Online Store",
        sourceName: "campaign_alpha",
        customerCountryCode: "US",
        dataCompletenessLevel: DataCompletenessLevel.MEDIUM,
        subtotalAmount: 100,
        totalDiscountAmount: 10,
        totalRefundAmount: 0,
        totalShippingRevenueAmount: 5,
        shippingCostEstimateAmount: 0,
        transactionFeeEstimateAmount: 3,
        grossProfitBeforeAdSpend: 52,
        lineItems: [
          {
            orderId: "order-1",
            variantId: "variant-1",
            sku: "PG-TEE-001",
            quantity: 1,
            subtotalAmount: 60,
            discountAmount: 5,
            refundedAmount: 0,
            productCostAmount: 20,
            grossProfitAmount: 35,
          },
          {
            orderId: "order-1",
            variantId: null,
            sku: "PG-BONUS-001",
            quantity: 1,
            subtotalAmount: 40,
            discountAmount: 5,
            refundedAmount: 0,
            productCostAmount: null,
            grossProfitAmount: 17,
          },
        ],
      },
      {
        orderId: "order-2",
        processedAt: new Date("2026-04-14T18:00:00.000Z"),
        salesChannel: "Online Store",
        sourceName: "campaign_alpha",
        customerCountryCode: "US",
        dataCompletenessLevel: DataCompletenessLevel.LOW,
        subtotalAmount: 50,
        totalDiscountAmount: 0,
        totalRefundAmount: 5,
        totalShippingRevenueAmount: 0,
        shippingCostEstimateAmount: 0,
        transactionFeeEstimateAmount: 1.5,
        grossProfitBeforeAdSpend: 28.5,
        lineItems: [
          {
            orderId: "order-2",
            variantId: "variant-1",
            sku: "PG-TEE-001",
            quantity: 1,
            subtotalAmount: 50,
            discountAmount: 0,
            refundedAmount: 5,
            productCostAmount: 15,
            grossProfitAmount: 28.5,
          },
        ],
      },
    ],
    {
      timeZone: "UTC",
    },
  );

  assert.equal(bundle.summary.datesProcessed, 1);
  assert.equal(bundle.summary.ordersProcessed, 2);
  assert.equal(bundle.summary.lineItemsProcessed, 3);
  assert.equal(bundle.shopMetrics.length, 1);
  assert.equal(bundle.channelMetrics.length, 1);
  assert.equal(bundle.skuMetrics.length, 2);
  assert.equal(bundle.regionMetrics.length, 1);
  assert.equal(bundle.sourceMetrics.length, 1);
  assert.equal(bundle.healthScores.length, 1);
  assert.equal(bundle.completenessSnapshots.length, 1);

  const [shopMetric] = bundle.shopMetrics;
  assert.equal(shopMetric.ordersCount, 2);
  assert.equal(shopMetric.grossSalesAmount, 150);
  assert.equal(shopMetric.discountAmount, 10);
  assert.equal(shopMetric.refundAmount, 5);
  assert.equal(shopMetric.grossProfitBeforeAdSpend, 80.5);
  assert.equal(shopMetric.completenessLevel, DataCompletenessLevel.MEDIUM);
  assert.equal(shopMetric.grossMarginRate, 0.53667);

  const [snapshot] = bundle.completenessSnapshots;
  assert.equal(snapshot.level, DataCompletenessLevel.MEDIUM);
  assert.equal(snapshot.variantCoverageRate, 0.66667);
  assert.equal(snapshot.orderCoverageRate, 0.5);

  const [healthScore] = bundle.healthScores;
  assert.equal(healthScore.score, 82);
  assert.equal(healthScore.levelLabel, "Healthy");
});

test("buildDailyMetricsBundle respects store timezone when grouping daily metrics", () => {
  const bundle = buildDailyMetricsBundle(
    [
      {
        orderId: "order-3",
        processedAt: new Date("2026-04-14T23:30:00.000Z"),
        salesChannel: null,
        sourceName: null,
        customerCountryCode: "SG",
        dataCompletenessLevel: DataCompletenessLevel.HIGH,
        subtotalAmount: 29,
        totalDiscountAmount: 0,
        totalRefundAmount: 0,
        totalShippingRevenueAmount: 0,
        shippingCostEstimateAmount: 0,
        transactionFeeEstimateAmount: 1,
        grossProfitBeforeAdSpend: 18,
        lineItems: [
          {
            orderId: "order-3",
            variantId: "variant-2",
            sku: "PG-TEE-002",
            quantity: 1,
            subtotalAmount: 29,
            discountAmount: 0,
            refundedAmount: 0,
            productCostAmount: 10,
            grossProfitAmount: 18,
          },
        ],
      },
    ],
    {
      timeZone: "Asia/Shanghai",
    },
  );

  assert.equal(bundle.shopMetrics.length, 1);
  assert.equal(bundle.shopMetrics[0]?.metricDate.toISOString(), "2026-04-15T00:00:00.000Z");
});
