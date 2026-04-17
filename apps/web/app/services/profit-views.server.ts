import db from "../db.server";

export const PROFIT_RANGE_VALUES = ["7d", "30d", "90d"] as const;

type ProfitRangeValue = (typeof PROFIT_RANGE_VALUES)[number];

function toNumber(value: unknown) {
  if (value == null) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRate(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(5));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function resolveProfitRange(value: string | null | undefined): ProfitRangeValue {
  const normalized = (value ?? "").trim().toLowerCase();
  return PROFIT_RANGE_VALUES.includes(normalized as ProfitRangeValue)
    ? (normalized as ProfitRangeValue)
    : "30d";
}

function getRangeDays(range: ProfitRangeValue) {
  switch (range) {
    case "7d":
      return 7;
    case "90d":
      return 90;
    case "30d":
    default:
      return 30;
  }
}

async function getShopRecord(shopDomain: string) {
  return db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      currencyCode: true,
      id: true,
      shopDomain: true,
      shopName: true,
    },
  });
}

export async function getProfitViewsOverview(args: {
  range: ProfitRangeValue;
  shopDomain: string;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    return null;
  }

  const latestMetric = await db.dailyShopMetric.findFirst({
    where: {
      shopId: shop.id,
    },
    orderBy: {
      metricDate: "desc",
    },
    select: {
      metricDate: true,
    },
  });

  if (!latestMetric) {
    return {
      channelRows: [],
      currencyCode: shop.currencyCode ?? "USD",
      latestMetricDate: null,
      orderRows: [],
      range: args.range,
      shopName: shop.shopName ?? shop.shopDomain,
      skuRows: [],
      totals: null,
    };
  }

  const rangeStart = addDays(latestMetric.metricDate, -(getRangeDays(args.range) - 1));
  const [orders, skuMetrics, channelMetrics, shopMetrics] = await Promise.all([
    db.order.findMany({
      where: {
        shopId: shop.id,
        processedAt: {
          gte: rangeStart,
        },
      },
      orderBy: {
        processedAt: "desc",
      },
      select: {
        currencyCode: true,
        grossProfitBeforeAdSpend: true,
        orderName: true,
        processedAt: true,
        salesChannel: true,
        totalDiscountAmount: true,
        totalRefundAmount: true,
        subtotalAmount: true,
      },
      take: 40,
    }),
    db.dailySkuMetric.findMany({
      where: {
        shopId: shop.id,
        metricDate: {
          gte: rangeStart,
        },
      },
      orderBy: {
        metricDate: "desc",
      },
      select: {
        grossMarginRate: true,
        grossProfitBeforeAdSpend: true,
        grossSalesAmount: true,
        metricDate: true,
        ordersCount: true,
        quantitySold: true,
        sku: true,
        variantId: true,
      },
    }),
    db.dailyChannelMetric.findMany({
      where: {
        shopId: shop.id,
        metricDate: {
          gte: rangeStart,
        },
      },
      orderBy: {
        metricDate: "desc",
      },
      select: {
        channelKey: true,
        grossMarginRate: true,
        grossProfitBeforeAdSpend: true,
        grossSalesAmount: true,
        metricDate: true,
        ordersCount: true,
        refundAmount: true,
        shippingCostAmount: true,
      },
    }),
    db.dailyShopMetric.findMany({
      where: {
        shopId: shop.id,
        metricDate: {
          gte: rangeStart,
        },
      },
      orderBy: {
        metricDate: "asc",
      },
      select: {
        discountAmount: true,
        grossMarginRate: true,
        grossProfitBeforeAdSpend: true,
        grossSalesAmount: true,
        metricDate: true,
        ordersCount: true,
        refundAmount: true,
      },
    }),
  ]);

  const skuRows = [...skuMetrics.reduce((accumulator, metric) => {
    const key = metric.variantId ?? metric.sku ?? `unknown:${metric.metricDate.toISOString()}`;
    const current = accumulator.get(key) ?? {
      grossProfitBeforeAdSpend: 0,
      grossSalesAmount: 0,
      latestMetricDate: metric.metricDate,
      ordersCount: 0,
      quantitySold: 0,
      sku: metric.sku ?? key,
      variantId: metric.variantId,
    };

    current.grossProfitBeforeAdSpend += toNumber(metric.grossProfitBeforeAdSpend);
    current.grossSalesAmount += toNumber(metric.grossSalesAmount);
    current.ordersCount += metric.ordersCount;
    current.quantitySold += metric.quantitySold;

    if (metric.metricDate > current.latestMetricDate) {
      current.latestMetricDate = metric.metricDate;
    }

    accumulator.set(key, current);
    return accumulator;
  }, new Map<string, {
    grossProfitBeforeAdSpend: number;
    grossSalesAmount: number;
    latestMetricDate: Date;
    ordersCount: number;
    quantitySold: number;
    sku: string;
    variantId: string | null;
  }>()).values()]
    .map((sku) => {
      const grossMarginRate = roundRate(
        sku.grossSalesAmount > 0 ? sku.grossProfitBeforeAdSpend / sku.grossSalesAmount : null,
      );

      return {
        grossMarginRate,
        grossProfitBeforeAdSpend: roundMoney(sku.grossProfitBeforeAdSpend).toFixed(2),
        grossSalesAmount: roundMoney(sku.grossSalesAmount).toFixed(2),
        latestMetricDate: sku.latestMetricDate.toISOString(),
        ordersCount: sku.ordersCount,
        quantitySold: sku.quantitySold,
        sku: sku.sku,
        variantId: sku.variantId,
      };
    })
    .sort((left, right) => Number(right.grossSalesAmount) - Number(left.grossSalesAmount))
    .slice(0, 20);

  const channelRows = [...channelMetrics.reduce((accumulator, metric) => {
    const current = accumulator.get(metric.channelKey) ?? {
      channelKey: metric.channelKey,
      grossProfitBeforeAdSpend: 0,
      grossSalesAmount: 0,
      ordersCount: 0,
      refundAmount: 0,
      shippingCostAmount: 0,
    };

    current.grossProfitBeforeAdSpend += toNumber(metric.grossProfitBeforeAdSpend);
    current.grossSalesAmount += toNumber(metric.grossSalesAmount);
    current.ordersCount += metric.ordersCount;
    current.refundAmount += toNumber(metric.refundAmount);
    current.shippingCostAmount += toNumber(metric.shippingCostAmount);
    accumulator.set(metric.channelKey, current);
    return accumulator;
  }, new Map<string, {
    channelKey: string;
    grossProfitBeforeAdSpend: number;
    grossSalesAmount: number;
    ordersCount: number;
    refundAmount: number;
    shippingCostAmount: number;
  }>()).values()]
    .map((channel) => ({
      channelKey: channel.channelKey,
      grossMarginRate: roundRate(
        channel.grossSalesAmount > 0 ? channel.grossProfitBeforeAdSpend / channel.grossSalesAmount : null,
      ),
      grossProfitBeforeAdSpend: roundMoney(channel.grossProfitBeforeAdSpend).toFixed(2),
      grossSalesAmount: roundMoney(channel.grossSalesAmount).toFixed(2),
      ordersCount: channel.ordersCount,
      refundAmount: roundMoney(channel.refundAmount).toFixed(2),
      shippingCostAmount: roundMoney(channel.shippingCostAmount).toFixed(2),
    }))
    .sort((left, right) => Number(right.grossSalesAmount) - Number(left.grossSalesAmount))
    .slice(0, 12);

  const totals = shopMetrics.reduce(
    (accumulator, metric) => {
      accumulator.discountAmount += toNumber(metric.discountAmount);
      accumulator.grossProfitBeforeAdSpend += toNumber(metric.grossProfitBeforeAdSpend);
      accumulator.grossSalesAmount += toNumber(metric.grossSalesAmount);
      accumulator.ordersCount += metric.ordersCount;
      accumulator.refundAmount += toNumber(metric.refundAmount);
      return accumulator;
    },
    {
      discountAmount: 0,
      grossProfitBeforeAdSpend: 0,
      grossSalesAmount: 0,
      ordersCount: 0,
      refundAmount: 0,
    },
  );

  return {
    channelRows,
    currencyCode: shop.currencyCode ?? "USD",
    latestMetricDate: latestMetric.metricDate.toISOString(),
    orderRows: orders.map((order) => ({
      currencyCode: order.currencyCode,
      grossProfitBeforeAdSpend: order.grossProfitBeforeAdSpend?.toString() ?? null,
      orderName: order.orderName ?? "Draft name",
      processedAt: order.processedAt?.toISOString() ?? null,
      salesChannel: order.salesChannel ?? "unknown",
      subtotalAmount: order.subtotalAmount?.toString() ?? null,
      totalDiscountAmount: order.totalDiscountAmount?.toString() ?? null,
      totalRefundAmount: order.totalRefundAmount?.toString() ?? null,
    })),
    range: args.range,
    shopName: shop.shopName ?? shop.shopDomain,
    skuRows,
    totals: {
      discountAmount: roundMoney(totals.discountAmount).toFixed(2),
      grossMarginRate: roundRate(
        totals.grossSalesAmount > 0 ? totals.grossProfitBeforeAdSpend / totals.grossSalesAmount : null,
      ),
      grossProfitBeforeAdSpend: roundMoney(totals.grossProfitBeforeAdSpend).toFixed(2),
      grossSalesAmount: roundMoney(totals.grossSalesAmount).toFixed(2),
      ordersCount: totals.ordersCount,
      refundAmount: roundMoney(totals.refundAmount).toFixed(2),
    },
  };
}
