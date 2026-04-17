import { DataCompletenessLevel } from "@prisma/client";
import prisma from "../../../../packages/db/src/client";
import { syncManagedAlertsForBundle } from "../services/alert-engine";
import type { DailyMetricsBundle } from "../services/metrics-core";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const shopDomain = `alerts-${Date.now()}.myshopify.com`;
  let createdShopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName: "Profit Guard Alerts Smoke Shop",
        currencyCode: "USD",
        ianaTimezone: "UTC",
        backfillStatus: "COMPLETED",
      },
    });
    createdShopId = shop.id;

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
          variantId: "variant-alert-1",
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
          variantId: "variant-alert-1",
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
          variantId: "variant-alert-2",
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
          variantId: "variant-alert-2",
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

    const summary = await prisma.$transaction((tx) =>
      syncManagedAlertsForBundle({
        tx,
        shopId: shop.id,
        bundle,
        currencyCode: "USD",
      }),
    );

    const [alerts, threads] = await Promise.all([
      prisma.alert.findMany({
        where: {
          shopId: shop.id,
        },
        orderBy: [
          {
            rankScore: "desc",
          },
          {
            detectedForDate: "desc",
          },
        ],
        select: {
          alertType: true,
          severity: true,
          title: true,
          impactAmount: true,
          rankScore: true,
        },
      }),
      prisma.alertThread.findMany({
        where: {
          shopId: shop.id,
        },
        select: {
          alertType: true,
          entityType: true,
          entityKey: true,
          isOpen: true,
        },
      }),
    ]);

    assertCondition(summary.alertsGenerated >= 12, "Expected at least 12 alerts to be generated");
    assertCondition(alerts.length >= 12, "Expected at least 12 persisted alerts");
    assertCondition(threads.length >= 10, "Expected alert threads to be created");
    assertCondition(alerts.some((alert) => alert.alertType === "SHOP_GMV_UP_MARGIN_FLAT"), "Missing GMV-vs-profit alert");
    assertCondition(alerts.some((alert) => alert.alertType === "ORDER_MIX_LOW_MARGIN"), "Missing order-mix alert");
    assertCondition(alerts.some((alert) => alert.alertType === "SOURCE_LOW_MARGIN"), "Missing source alert");

    console.info(
      JSON.stringify(
        {
          summary,
          alerts: alerts.map((alert) => ({
            alertType: alert.alertType,
            severity: alert.severity,
            title: alert.title,
            impactAmount: alert.impactAmount?.toString() ?? null,
            rankScore: alert.rankScore?.toString() ?? null,
          })),
          threads,
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdShopId) {
      await prisma.shop.delete({
        where: {
          id: createdShopId,
        },
      });
    }

    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Alert engine failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
