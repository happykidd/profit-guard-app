import { DataCompletenessLevel } from "@prisma/client";

type SupportedCompletenessLevel = DataCompletenessLevel;

export type OrderMetricLineItemInput = {
  orderId: string;
  variantId: string | null;
  sku: string | null;
  quantity: number;
  subtotalAmount: number | null;
  discountAmount: number | null;
  refundedAmount: number | null;
  productCostAmount: number | null;
  grossProfitAmount: number | null;
};

export type OrderMetricInput = {
  orderId: string;
  processedAt: Date;
  salesChannel: string | null;
  sourceName: string | null;
  customerCountryCode: string | null;
  dataCompletenessLevel: SupportedCompletenessLevel;
  subtotalAmount: number | null;
  totalDiscountAmount: number | null;
  totalRefundAmount: number | null;
  totalShippingRevenueAmount: number | null;
  shippingCostEstimateAmount: number | null;
  transactionFeeEstimateAmount: number | null;
  grossProfitBeforeAdSpend: number | null;
  lineItems: OrderMetricLineItemInput[];
};

export type DailyShopMetricInput = {
  metricDate: Date;
  ordersCount: number;
  grossSalesAmount: number;
  discountAmount: number;
  refundAmount: number;
  shippingRevenueAmount: number;
  shippingCostEstimateAmount: number;
  transactionFeeEstimateAmount: number;
  productCostAmount: number;
  grossProfitBeforeAdSpend: number;
  grossMarginRate: number | null;
  averageOrderShippingCost: number | null;
  refundRate: number | null;
  discountRate: number | null;
  completenessLevel: SupportedCompletenessLevel;
};

export type DailyChannelMetricInput = {
  metricDate: Date;
  channelKey: string;
  ordersCount: number;
  grossSalesAmount: number;
  grossProfitBeforeAdSpend: number;
  grossMarginRate: number | null;
  refundAmount: number;
  shippingCostAmount: number;
};

export type DailySkuMetricInput = {
  metricDate: Date;
  variantId: string | null;
  sku: string | null;
  ordersCount: number;
  quantitySold: number;
  grossSalesAmount: number;
  discountAmount: number;
  refundAmount: number;
  productCostAmount: number;
  grossProfitBeforeAdSpend: number;
  grossMarginRate: number | null;
};

export type DailyRegionMetricInput = {
  metricDate: Date;
  countryCode: string;
  ordersCount: number;
  grossSalesAmount: number;
  refundAmount: number;
  shippingCostAmount: number;
  refundRate: number | null;
  averageOrderShippingCost: number | null;
};

export type DailySourceMetricInput = {
  metricDate: Date;
  sourceKey: string;
  ordersCount: number;
  grossSalesAmount: number;
  grossProfitBeforeAdSpend: number;
  grossMarginRate: number | null;
};

export type CompletenessSnapshotInput = {
  snapshotDate: Date;
  level: SupportedCompletenessLevel;
  variantCoverageRate: number | null;
  orderCoverageRate: number | null;
  payload: Record<string, unknown>;
};

export type HealthScoreInput = {
  scoreDate: Date;
  score: number;
  levelLabel: string;
  deductionsPayload: Record<string, unknown>;
};

export type DailyMetricsBundle = {
  shopMetrics: DailyShopMetricInput[];
  channelMetrics: DailyChannelMetricInput[];
  skuMetrics: DailySkuMetricInput[];
  regionMetrics: DailyRegionMetricInput[];
  sourceMetrics: DailySourceMetricInput[];
  completenessSnapshots: CompletenessSnapshotInput[];
  healthScores: HealthScoreInput[];
  summary: {
    datesProcessed: number;
    ordersProcessed: number;
    lineItemsProcessed: number;
    timeZone: string;
  };
};

type DailyAccumulator = {
  dateKey: string;
  metricDate: Date;
  ordersCount: number;
  grossSalesAmount: number;
  discountAmount: number;
  refundAmount: number;
  shippingRevenueAmount: number;
  shippingCostEstimateAmount: number;
  transactionFeeEstimateAmount: number;
  productCostAmount: number;
  grossProfitBeforeAdSpend: number;
  lineItemsCount: number;
  coveredLineItemsCount: number;
  coveredOrdersCount: number;
};

type ChannelAccumulator = {
  metricDate: Date;
  channelKey: string;
  ordersCount: number;
  grossSalesAmount: number;
  grossProfitBeforeAdSpend: number;
  refundAmount: number;
  shippingCostAmount: number;
};

type SkuAccumulator = {
  metricDate: Date;
  variantId: string | null;
  sku: string | null;
  orderIds: Set<string>;
  quantitySold: number;
  grossSalesAmount: number;
  discountAmount: number;
  refundAmount: number;
  productCostAmount: number;
  grossProfitBeforeAdSpend: number;
};

type RegionAccumulator = {
  metricDate: Date;
  countryCode: string;
  ordersCount: number;
  grossSalesAmount: number;
  refundAmount: number;
  shippingCostAmount: number;
};

type SourceAccumulator = {
  metricDate: Date;
  sourceKey: string;
  ordersCount: number;
  grossSalesAmount: number;
  grossProfitBeforeAdSpend: number;
};

type CompletenessAssessment = {
  level: SupportedCompletenessLevel;
  variantCoverageRate: number | null;
  orderCoverageRate: number | null;
};

type HealthDeduction = {
  key: string;
  points: number;
  reason: string;
};

type HealthScoreBreakdown = {
  score: number;
  levelLabel: string;
  deductionsPayload: {
    deductions: HealthDeduction[];
    inputs: Record<string, unknown>;
  };
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }

  return value;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRate(value: number) {
  return Number(value.toFixed(5));
}

function divideOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function toMetricDateKey(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}

function metricDateFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function normalizeChannel(channel: string | null) {
  const cleaned = channel?.trim().toLowerCase();
  return cleaned && cleaned.length > 0 ? cleaned : "unknown";
}

function normalizeCountryCode(countryCode: string | null) {
  const cleaned = countryCode?.trim().toUpperCase();
  return cleaned && cleaned.length > 0 ? cleaned : "UNKNOWN";
}

export function assessCompletenessLevel(args: {
  totalOrders: number;
  coveredOrders: number;
  totalLineItems: number;
  coveredLineItems: number;
}): CompletenessAssessment {
  const variantCoverageRate = divideOrNull(args.coveredLineItems, args.totalLineItems);
  const orderCoverageRate = divideOrNull(args.coveredOrders, args.totalOrders);

  if (
    variantCoverageRate != null &&
    orderCoverageRate != null &&
    variantCoverageRate >= 0.9 &&
    orderCoverageRate >= 0.8
  ) {
    return {
      level: DataCompletenessLevel.HIGH,
      variantCoverageRate: roundRate(variantCoverageRate),
      orderCoverageRate: roundRate(orderCoverageRate),
    };
  }

  if (
    variantCoverageRate != null &&
    orderCoverageRate != null &&
    variantCoverageRate >= 0.6 &&
    orderCoverageRate >= 0.5
  ) {
    return {
      level: DataCompletenessLevel.MEDIUM,
      variantCoverageRate: roundRate(variantCoverageRate),
      orderCoverageRate: roundRate(orderCoverageRate),
    };
  }

  return {
    level: DataCompletenessLevel.LOW,
    variantCoverageRate: variantCoverageRate == null ? null : roundRate(variantCoverageRate),
    orderCoverageRate: orderCoverageRate == null ? null : roundRate(orderCoverageRate),
  };
}

export function calculateHealthScore(metric: {
  ordersCount: number;
  grossMarginRate: number | null;
  refundRate: number | null;
  discountRate: number | null;
  completenessLevel: SupportedCompletenessLevel;
}): HealthScoreBreakdown {
  const deductions: HealthDeduction[] = [];
  let score = 100;

  if (metric.ordersCount < 3) {
    deductions.push({
      key: "low_sample_size",
      points: 8,
      reason: "Daily sample size is still small.",
    });
    score -= 8;
  }

  if (metric.completenessLevel === DataCompletenessLevel.LOW) {
    deductions.push({
      key: "low_completeness",
      points: 25,
      reason: "Product cost coverage is still incomplete.",
    });
    score -= 25;
  } else if (metric.completenessLevel === DataCompletenessLevel.MEDIUM) {
    deductions.push({
      key: "medium_completeness",
      points: 10,
      reason: "Some orders still rely on estimated cost coverage.",
    });
    score -= 10;
  }

  if (metric.grossMarginRate == null) {
    deductions.push({
      key: "missing_margin",
      points: 15,
      reason: "Gross margin is not available yet.",
    });
    score -= 15;
  } else if (metric.grossMarginRate < 0.1) {
    deductions.push({
      key: "critical_margin",
      points: 35,
      reason: "Gross margin is below 10%.",
    });
    score -= 35;
  } else if (metric.grossMarginRate < 0.2) {
    deductions.push({
      key: "low_margin",
      points: 20,
      reason: "Gross margin is below 20%.",
    });
    score -= 20;
  } else if (metric.grossMarginRate < 0.3) {
    deductions.push({
      key: "soft_margin",
      points: 10,
      reason: "Gross margin is below the 30% watch threshold.",
    });
    score -= 10;
  }

  if (metric.refundRate != null) {
    if (metric.refundRate >= 0.15) {
      deductions.push({
        key: "high_refund_rate",
        points: 20,
        reason: "Refund rate is above 15%.",
      });
      score -= 20;
    } else if (metric.refundRate >= 0.07) {
      deductions.push({
        key: "watch_refund_rate",
        points: 10,
        reason: "Refund rate is above 7%.",
      });
      score -= 10;
    }
  }

  if (metric.discountRate != null) {
    if (metric.discountRate >= 0.25) {
      deductions.push({
        key: "high_discount_rate",
        points: 10,
        reason: "Discount share is above 25%.",
      });
      score -= 10;
    } else if (metric.discountRate >= 0.12) {
      deductions.push({
        key: "watch_discount_rate",
        points: 5,
        reason: "Discount share is above 12%.",
      });
      score -= 5;
    }
  }

  const finalScore = clampScore(score);
  const levelLabel =
    finalScore >= 80 ? "Healthy" : finalScore >= 60 ? "Monitor" : finalScore >= 40 ? "At Risk" : "Critical";

  return {
    score: finalScore,
    levelLabel,
    deductionsPayload: {
      deductions,
      inputs: {
        ordersCount: metric.ordersCount,
        grossMarginRate: metric.grossMarginRate,
        refundRate: metric.refundRate,
        discountRate: metric.discountRate,
        completenessLevel: metric.completenessLevel,
      },
    },
  };
}

export function buildDailyMetricsBundle(
  orders: OrderMetricInput[],
  options?: {
    timeZone?: string;
  },
): DailyMetricsBundle {
  const timeZone = options?.timeZone ?? "UTC";
  const dayMap = new Map<string, DailyAccumulator>();
  const channelMap = new Map<string, ChannelAccumulator>();
  const skuMap = new Map<string, SkuAccumulator>();
  const regionMap = new Map<string, RegionAccumulator>();
  const sourceMap = new Map<string, SourceAccumulator>();
  let lineItemsProcessed = 0;

  for (const order of orders) {
    const dateKey = toMetricDateKey(order.processedAt, timeZone);
    const metricDate = metricDateFromKey(dateKey);
    const grossSalesAmount = normalizeNumber(order.subtotalAmount);
    const discountAmount = normalizeNumber(order.totalDiscountAmount);
    const refundAmount = normalizeNumber(order.totalRefundAmount);
    const shippingRevenueAmount = normalizeNumber(order.totalShippingRevenueAmount);
    const shippingCostEstimateAmount = normalizeNumber(order.shippingCostEstimateAmount);
    const transactionFeeEstimateAmount = normalizeNumber(order.transactionFeeEstimateAmount);
    const grossProfitBeforeAdSpend = normalizeNumber(order.grossProfitBeforeAdSpend);
    const channelKey = normalizeChannel(order.salesChannel);
    const sourceKey = normalizeChannel(order.sourceName);
    const countryCode = normalizeCountryCode(order.customerCountryCode);

    const dayAccumulator = dayMap.get(dateKey) ?? {
      dateKey,
      metricDate,
      ordersCount: 0,
      grossSalesAmount: 0,
      discountAmount: 0,
      refundAmount: 0,
      shippingRevenueAmount: 0,
      shippingCostEstimateAmount: 0,
      transactionFeeEstimateAmount: 0,
      productCostAmount: 0,
      grossProfitBeforeAdSpend: 0,
      lineItemsCount: 0,
      coveredLineItemsCount: 0,
      coveredOrdersCount: 0,
    };

    dayAccumulator.ordersCount += 1;
    dayAccumulator.grossSalesAmount += grossSalesAmount;
    dayAccumulator.discountAmount += discountAmount;
    dayAccumulator.refundAmount += refundAmount;
    dayAccumulator.shippingRevenueAmount += shippingRevenueAmount;
    dayAccumulator.shippingCostEstimateAmount += shippingCostEstimateAmount;
    dayAccumulator.transactionFeeEstimateAmount += transactionFeeEstimateAmount;
    dayAccumulator.grossProfitBeforeAdSpend += grossProfitBeforeAdSpend;

    if (order.dataCompletenessLevel !== DataCompletenessLevel.LOW) {
      dayAccumulator.coveredOrdersCount += 1;
    }

    const channelAccumulator = channelMap.get(`${dateKey}:${channelKey}`) ?? {
      metricDate,
      channelKey,
      ordersCount: 0,
      grossSalesAmount: 0,
      grossProfitBeforeAdSpend: 0,
      refundAmount: 0,
      shippingCostAmount: 0,
    };

    channelAccumulator.ordersCount += 1;
    channelAccumulator.grossSalesAmount += grossSalesAmount;
    channelAccumulator.grossProfitBeforeAdSpend += grossProfitBeforeAdSpend;
    channelAccumulator.refundAmount += refundAmount;
    channelAccumulator.shippingCostAmount += shippingCostEstimateAmount;

    const regionAccumulator = regionMap.get(`${dateKey}:${countryCode}`) ?? {
      metricDate,
      countryCode,
      ordersCount: 0,
      grossSalesAmount: 0,
      refundAmount: 0,
      shippingCostAmount: 0,
    };

    regionAccumulator.ordersCount += 1;
    regionAccumulator.grossSalesAmount += grossSalesAmount;
    regionAccumulator.refundAmount += refundAmount;
    regionAccumulator.shippingCostAmount += shippingCostEstimateAmount;

    const sourceAccumulator = sourceMap.get(`${dateKey}:${sourceKey}`) ?? {
      metricDate,
      sourceKey,
      ordersCount: 0,
      grossSalesAmount: 0,
      grossProfitBeforeAdSpend: 0,
    };

    sourceAccumulator.ordersCount += 1;
    sourceAccumulator.grossSalesAmount += grossSalesAmount;
    sourceAccumulator.grossProfitBeforeAdSpend += grossProfitBeforeAdSpend;

    for (const lineItem of order.lineItems) {
      lineItemsProcessed += 1;
      const lineSubtotal = normalizeNumber(lineItem.subtotalAmount);
      const lineDiscount = normalizeNumber(lineItem.discountAmount);
      const lineRefund = normalizeNumber(lineItem.refundedAmount);
      const lineProductCost = normalizeNumber(lineItem.productCostAmount);
      const lineGrossProfit = normalizeNumber(lineItem.grossProfitAmount);
      const quantity = Number.isFinite(lineItem.quantity) ? lineItem.quantity : 0;

      dayAccumulator.lineItemsCount += 1;

      if (lineItem.productCostAmount != null) {
        dayAccumulator.coveredLineItemsCount += 1;
        dayAccumulator.productCostAmount += lineProductCost;
      }

      const skuKey = `${dateKey}:${lineItem.variantId ?? "no-variant"}:${lineItem.sku ?? "no-sku"}`;
      const skuAccumulator = skuMap.get(skuKey) ?? {
        metricDate,
        variantId: lineItem.variantId,
        sku: lineItem.sku,
        orderIds: new Set<string>(),
        quantitySold: 0,
        grossSalesAmount: 0,
        discountAmount: 0,
        refundAmount: 0,
        productCostAmount: 0,
        grossProfitBeforeAdSpend: 0,
      };

      skuAccumulator.orderIds.add(order.orderId);
      skuAccumulator.quantitySold += quantity;
      skuAccumulator.grossSalesAmount += lineSubtotal;
      skuAccumulator.discountAmount += lineDiscount;
      skuAccumulator.refundAmount += lineRefund;
      skuAccumulator.productCostAmount += lineProductCost;
      skuAccumulator.grossProfitBeforeAdSpend += lineGrossProfit;

      skuMap.set(skuKey, skuAccumulator);
    }

    dayMap.set(dateKey, dayAccumulator);
    channelMap.set(`${dateKey}:${channelKey}`, channelAccumulator);
    regionMap.set(`${dateKey}:${countryCode}`, regionAccumulator);
    sourceMap.set(`${dateKey}:${sourceKey}`, sourceAccumulator);
  }

  const sortedDays = [...dayMap.values()].sort((left, right) =>
    left.metricDate.getTime() - right.metricDate.getTime(),
  );

  const shopMetrics = sortedDays.map((day) => {
    const completeness = assessCompletenessLevel({
      totalOrders: day.ordersCount,
      coveredOrders: day.coveredOrdersCount,
      totalLineItems: day.lineItemsCount,
      coveredLineItems: day.coveredLineItemsCount,
    });
    const grossMarginRate = divideOrNull(day.grossProfitBeforeAdSpend, day.grossSalesAmount);
    const refundRate = divideOrNull(day.refundAmount, day.grossSalesAmount);
    const discountRate = divideOrNull(day.discountAmount, day.grossSalesAmount);
    const averageOrderShippingCost = divideOrNull(day.shippingCostEstimateAmount, day.ordersCount);

    return {
      metricDate: day.metricDate,
      ordersCount: day.ordersCount,
      grossSalesAmount: roundMoney(day.grossSalesAmount),
      discountAmount: roundMoney(day.discountAmount),
      refundAmount: roundMoney(day.refundAmount),
      shippingRevenueAmount: roundMoney(day.shippingRevenueAmount),
      shippingCostEstimateAmount: roundMoney(day.shippingCostEstimateAmount),
      transactionFeeEstimateAmount: roundMoney(day.transactionFeeEstimateAmount),
      productCostAmount: roundMoney(day.productCostAmount),
      grossProfitBeforeAdSpend: roundMoney(day.grossProfitBeforeAdSpend),
      grossMarginRate: grossMarginRate == null ? null : roundRate(grossMarginRate),
      averageOrderShippingCost:
        averageOrderShippingCost == null ? null : roundMoney(averageOrderShippingCost),
      refundRate: refundRate == null ? null : roundRate(refundRate),
      discountRate: discountRate == null ? null : roundRate(discountRate),
      completenessLevel: completeness.level,
    };
  });

  const completenessSnapshots = sortedDays.map((day) => {
    const completeness = assessCompletenessLevel({
      totalOrders: day.ordersCount,
      coveredOrders: day.coveredOrdersCount,
      totalLineItems: day.lineItemsCount,
      coveredLineItems: day.coveredLineItemsCount,
    });

    return {
      snapshotDate: day.metricDate,
      level: completeness.level,
      variantCoverageRate: completeness.variantCoverageRate,
      orderCoverageRate: completeness.orderCoverageRate,
      payload: {
        totalOrders: day.ordersCount,
        coveredOrders: day.coveredOrdersCount,
        totalLineItems: day.lineItemsCount,
        coveredLineItems: day.coveredLineItemsCount,
        timeZone,
      },
    };
  });

  const healthScores = shopMetrics.map((metric) => {
    const breakdown = calculateHealthScore({
      ordersCount: metric.ordersCount,
      grossMarginRate: metric.grossMarginRate,
      refundRate: metric.refundRate,
      discountRate: metric.discountRate,
      completenessLevel: metric.completenessLevel,
    });

    return {
      scoreDate: metric.metricDate,
      score: breakdown.score,
      levelLabel: breakdown.levelLabel,
      deductionsPayload: breakdown.deductionsPayload,
    };
  });

  const channelMetrics = [...channelMap.values()]
    .sort((left, right) => left.metricDate.getTime() - right.metricDate.getTime())
    .map((channel) => {
      const grossMarginRate = divideOrNull(channel.grossProfitBeforeAdSpend, channel.grossSalesAmount);

      return {
        metricDate: channel.metricDate,
        channelKey: channel.channelKey,
        ordersCount: channel.ordersCount,
        grossSalesAmount: roundMoney(channel.grossSalesAmount),
        grossProfitBeforeAdSpend: roundMoney(channel.grossProfitBeforeAdSpend),
        grossMarginRate: grossMarginRate == null ? null : roundRate(grossMarginRate),
        refundAmount: roundMoney(channel.refundAmount),
        shippingCostAmount: roundMoney(channel.shippingCostAmount),
      };
    });

  const skuMetrics = [...skuMap.values()]
    .sort((left, right) => left.metricDate.getTime() - right.metricDate.getTime())
    .map((sku) => {
      const grossMarginRate = divideOrNull(sku.grossProfitBeforeAdSpend, sku.grossSalesAmount);

      return {
        metricDate: sku.metricDate,
        variantId: sku.variantId,
        sku: sku.sku,
        ordersCount: sku.orderIds.size,
        quantitySold: sku.quantitySold,
        grossSalesAmount: roundMoney(sku.grossSalesAmount),
        discountAmount: roundMoney(sku.discountAmount),
        refundAmount: roundMoney(sku.refundAmount),
        productCostAmount: roundMoney(sku.productCostAmount),
        grossProfitBeforeAdSpend: roundMoney(sku.grossProfitBeforeAdSpend),
        grossMarginRate: grossMarginRate == null ? null : roundRate(grossMarginRate),
      };
    });

  const regionMetrics = [...regionMap.values()]
    .sort((left, right) => left.metricDate.getTime() - right.metricDate.getTime())
    .map((region) => ({
      metricDate: region.metricDate,
      countryCode: region.countryCode,
      ordersCount: region.ordersCount,
      grossSalesAmount: roundMoney(region.grossSalesAmount),
      refundAmount: roundMoney(region.refundAmount),
      shippingCostAmount: roundMoney(region.shippingCostAmount),
      refundRate:
        divideOrNull(region.refundAmount, region.grossSalesAmount) == null
          ? null
          : roundRate(divideOrNull(region.refundAmount, region.grossSalesAmount) as number),
      averageOrderShippingCost:
        divideOrNull(region.shippingCostAmount, region.ordersCount) == null
          ? null
          : roundMoney(divideOrNull(region.shippingCostAmount, region.ordersCount) as number),
    }));

  const sourceMetrics = [...sourceMap.values()]
    .sort((left, right) => left.metricDate.getTime() - right.metricDate.getTime())
    .map((source) => ({
      metricDate: source.metricDate,
      sourceKey: source.sourceKey,
      ordersCount: source.ordersCount,
      grossSalesAmount: roundMoney(source.grossSalesAmount),
      grossProfitBeforeAdSpend: roundMoney(source.grossProfitBeforeAdSpend),
      grossMarginRate:
        divideOrNull(source.grossProfitBeforeAdSpend, source.grossSalesAmount) == null
          ? null
          : roundRate(divideOrNull(source.grossProfitBeforeAdSpend, source.grossSalesAmount) as number),
    }));

  return {
    shopMetrics,
    channelMetrics,
    skuMetrics,
    regionMetrics,
    sourceMetrics,
    completenessSnapshots,
    healthScores,
    summary: {
      datesProcessed: shopMetrics.length,
      ordersProcessed: orders.length,
      lineItemsProcessed,
      timeZone,
    },
  };
}
