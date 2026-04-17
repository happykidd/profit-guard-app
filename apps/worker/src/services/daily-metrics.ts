import prisma from "../../../../packages/db/src/client";
import { syncManagedAlertsForBundle } from "./alert-engine";
import { buildDailyMetricsBundle } from "./metrics-core";

type SyncSummary = {
  recordsSynced: number;
  recordsTotal: number;
  metadata: Record<string, unknown>;
};

function toNumber(value: unknown) {
  if (value == null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDecimalString(value: number | null, digits = 2) {
  if (value == null) {
    return null;
  }

  return value.toFixed(digits);
}

function toRequiredDecimalString(value: number, digits = 2) {
  return value.toFixed(digits);
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export async function rebuildDailyMetrics(args: {
  shopId: string;
  runId: string;
}): Promise<SyncSummary> {
  const shop = await prisma.shop.findUnique({
    where: {
      id: args.shopId,
    },
    select: {
      ianaTimezone: true,
    },
  });

  const orders = await prisma.order.findMany({
    where: {
      shopId: args.shopId,
      processedAt: {
        not: null,
      },
    },
    include: {
      lineItems: {
        select: {
          orderId: true,
          variantId: true,
          sku: true,
          quantity: true,
          subtotalAmount: true,
          discountAmount: true,
          refundedAmount: true,
          productCostAmount: true,
          grossProfitAmount: true,
        },
      },
    },
    orderBy: {
      processedAt: "asc",
    },
  });

  const bundle = buildDailyMetricsBundle(
    orders
      .filter((order) => order.processedAt != null)
      .map((order) => ({
        orderId: order.id,
        processedAt: order.processedAt as Date,
        salesChannel: order.salesChannel ?? order.sourceName ?? null,
        sourceName: order.sourceName ?? null,
        customerCountryCode: order.customerCountryCode ?? null,
        dataCompletenessLevel: order.dataCompletenessLevel,
        subtotalAmount: toNumber(order.subtotalAmount),
        totalDiscountAmount: toNumber(order.totalDiscountAmount),
        totalRefundAmount: toNumber(order.totalRefundAmount),
        totalShippingRevenueAmount: toNumber(order.totalShippingRevenueAmount),
        shippingCostEstimateAmount: toNumber(order.shippingCostEstimateAmount),
        transactionFeeEstimateAmount: toNumber(order.transactionFeeEstimateAmount),
        grossProfitBeforeAdSpend: toNumber(order.grossProfitBeforeAdSpend),
        lineItems: order.lineItems.map((lineItem) => ({
          orderId: lineItem.orderId,
          variantId: lineItem.variantId,
          sku: lineItem.sku,
          quantity: lineItem.quantity,
          subtotalAmount: toNumber(lineItem.subtotalAmount),
          discountAmount: toNumber(lineItem.discountAmount),
          refundedAmount: toNumber(lineItem.refundedAmount),
          productCostAmount: toNumber(lineItem.productCostAmount),
          grossProfitAmount: toNumber(lineItem.grossProfitAmount),
        })),
      })),
    {
      timeZone: shop?.ianaTimezone ?? "UTC",
    },
  );

  const metricDates = [...new Set(bundle.shopMetrics.map((metric) => metric.metricDate.toISOString()))].map(
    (value) => new Date(value),
  );
  let generatedAlerts = 0;

  await prisma.$transaction(async (tx) => {
    if (metricDates.length > 0) {
      await Promise.all([
        tx.dailySkuMetric.deleteMany({
          where: {
            shopId: args.shopId,
            metricDate: {
              in: metricDates,
            },
          },
        }),
        tx.dailyChannelMetric.deleteMany({
          where: {
            shopId: args.shopId,
            metricDate: {
              in: metricDates,
            },
          },
        }),
        tx.dailyShopMetric.deleteMany({
          where: {
            shopId: args.shopId,
            metricDate: {
              in: metricDates,
            },
          },
        }),
        tx.profitHealthScore.deleteMany({
          where: {
            shopId: args.shopId,
            scoreDate: {
              in: metricDates,
            },
          },
        }),
        tx.dataCompletenessSnapshot.deleteMany({
          where: {
            shopId: args.shopId,
            snapshotDate: {
              in: metricDates,
            },
          },
        }),
      ]);
    }

    if (bundle.shopMetrics.length > 0) {
      await tx.dailyShopMetric.createMany({
        data: bundle.shopMetrics.map((metric) => ({
          shopId: args.shopId,
          metricDate: metric.metricDate,
          ordersCount: metric.ordersCount,
          grossSalesAmount: toRequiredDecimalString(metric.grossSalesAmount),
          discountAmount: toRequiredDecimalString(metric.discountAmount),
          refundAmount: toRequiredDecimalString(metric.refundAmount),
          shippingRevenueAmount: toRequiredDecimalString(metric.shippingRevenueAmount),
          shippingCostEstimateAmount: toRequiredDecimalString(metric.shippingCostEstimateAmount),
          transactionFeeEstimateAmount: toRequiredDecimalString(metric.transactionFeeEstimateAmount),
          productCostAmount: toRequiredDecimalString(metric.productCostAmount),
          grossProfitBeforeAdSpend: toRequiredDecimalString(metric.grossProfitBeforeAdSpend),
          grossMarginRate: toDecimalString(metric.grossMarginRate, 5),
          averageOrderShippingCost: toDecimalString(metric.averageOrderShippingCost),
          refundRate: toDecimalString(metric.refundRate, 5),
          discountRate: toDecimalString(metric.discountRate, 5),
          completenessLevel: metric.completenessLevel,
        })),
      });
    }

    if (bundle.channelMetrics.length > 0) {
      await tx.dailyChannelMetric.createMany({
        data: bundle.channelMetrics.map((metric) => ({
          shopId: args.shopId,
          metricDate: metric.metricDate,
          channelKey: metric.channelKey,
          ordersCount: metric.ordersCount,
          grossSalesAmount: toRequiredDecimalString(metric.grossSalesAmount),
          grossProfitBeforeAdSpend: toRequiredDecimalString(metric.grossProfitBeforeAdSpend),
          grossMarginRate: toDecimalString(metric.grossMarginRate, 5),
          refundAmount: toRequiredDecimalString(metric.refundAmount),
          shippingCostAmount: toRequiredDecimalString(metric.shippingCostAmount),
        })),
      });
    }

    if (bundle.skuMetrics.length > 0) {
      await tx.dailySkuMetric.createMany({
        data: bundle.skuMetrics.map((metric) => ({
          shopId: args.shopId,
          variantId: metric.variantId,
          metricDate: metric.metricDate,
          sku: metric.sku,
          ordersCount: metric.ordersCount,
          quantitySold: metric.quantitySold,
          grossSalesAmount: toRequiredDecimalString(metric.grossSalesAmount),
          discountAmount: toRequiredDecimalString(metric.discountAmount),
          refundAmount: toRequiredDecimalString(metric.refundAmount),
          productCostAmount: toRequiredDecimalString(metric.productCostAmount),
          grossProfitBeforeAdSpend: toRequiredDecimalString(metric.grossProfitBeforeAdSpend),
          grossMarginRate: toDecimalString(metric.grossMarginRate, 5),
        })),
      });
    }

    if (bundle.healthScores.length > 0) {
      await tx.profitHealthScore.createMany({
        data: bundle.healthScores.map((score) => ({
          shopId: args.shopId,
          scoreDate: score.scoreDate,
          score: score.score,
          levelLabel: score.levelLabel,
          deductionsPayload: toJsonValue(score.deductionsPayload),
        })),
      });
    }

    if (bundle.completenessSnapshots.length > 0) {
      await tx.dataCompletenessSnapshot.createMany({
        data: bundle.completenessSnapshots.map((snapshot) => ({
          shopId: args.shopId,
          snapshotDate: snapshot.snapshotDate,
          level: snapshot.level,
          variantCoverageRate: toDecimalString(snapshot.variantCoverageRate, 5),
          orderCoverageRate: toDecimalString(snapshot.orderCoverageRate, 5),
          payload: toJsonValue(snapshot.payload),
        })),
      });
    }

    const alertSummary = await syncManagedAlertsForBundle({
      tx,
      shopId: args.shopId,
      bundle,
      currencyCode: orders[0]?.currencyCode ?? "USD",
    });
    generatedAlerts = alertSummary.alertsGenerated;

    await tx.syncRun.update({
      where: {
        id: args.runId,
      },
      data: {
        recordsSynced: bundle.summary.ordersProcessed,
        recordsTotal: bundle.summary.ordersProcessed,
        cursor: null,
        metadata: toJsonValue({
          stage: "daily_metrics",
          generatedShopDays: bundle.shopMetrics.length,
          generatedChannelDays: bundle.channelMetrics.length,
          generatedSkuDays: bundle.skuMetrics.length,
          generatedHealthScores: bundle.healthScores.length,
          generatedCompletenessSnapshots: bundle.completenessSnapshots.length,
          generatedAlerts: alertSummary.alertsGenerated,
          lineItemsProcessed: bundle.summary.lineItemsProcessed,
          timeZone: bundle.summary.timeZone,
        }),
      },
    });
  });

  return {
    recordsSynced: bundle.summary.ordersProcessed,
    recordsTotal: bundle.summary.ordersProcessed,
    metadata: {
      stage: "daily_metrics",
      datesProcessed: bundle.summary.datesProcessed,
      ordersProcessed: bundle.summary.ordersProcessed,
      lineItemsProcessed: bundle.summary.lineItemsProcessed,
      timeZone: bundle.summary.timeZone,
      generatedShopDays: bundle.shopMetrics.length,
      generatedChannelDays: bundle.channelMetrics.length,
      generatedSkuDays: bundle.skuMetrics.length,
      generatedHealthScores: bundle.healthScores.length,
      generatedCompletenessSnapshots: bundle.completenessSnapshots.length,
      generatedAlerts,
    },
  };
}
