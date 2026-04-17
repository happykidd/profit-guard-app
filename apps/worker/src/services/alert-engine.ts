import {
  AlertSeverity,
  AlertStatus,
  DataCompletenessLevel,
  Prisma,
} from "@prisma/client";
import type {
  CompletenessSnapshotInput,
  DailyChannelMetricInput,
  DailyMetricsBundle,
  DailyRegionMetricInput,
  DailyShopMetricInput,
  DailySkuMetricInput,
  DailySourceMetricInput,
} from "./metrics-core";

export const MANAGED_ALERT_TYPES = [
  "SHOP_LOW_MARGIN",
  "SHOP_HIGH_REFUND_RATE",
  "SHOP_LOW_COMPLETENESS",
  "SKU_NEGATIVE_MARGIN",
  "SHOP_HIGH_DISCOUNT_RATE",
  "SHOP_HIGH_SHIPPING_COST",
  "SHOP_GMV_UP_MARGIN_FLAT",
  "CHANNEL_LOW_MARGIN",
  "SKU_MARGIN_DROP",
  "REGION_HIGH_REFUND_RATE",
  "REGION_HIGH_SHIPPING_COST",
  "PROMO_LOW_MARGIN",
  "ORDER_MIX_LOW_MARGIN",
  "SKU_DEEP_DISCOUNT",
  "SOURCE_LOW_MARGIN",
] as const;

type ManagedAlertType = (typeof MANAGED_ALERT_TYPES)[number];

type AlertCandidate = {
  alertType: ManagedAlertType;
  severity: AlertSeverity;
  entityType: string;
  entityKey: string;
  title: string;
  impactAmount: number | null;
  currencyCode: string | null;
  confidenceLevel: DataCompletenessLevel;
  completenessLevel: DataCompletenessLevel;
  detectedForDate: Date;
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  expiresAt: Date | null;
  rankScore: number;
  rulePayload: Record<string, unknown>;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRate(value: number | null, digits = 5) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function roundRank(value: number) {
  return Number(value.toFixed(4));
}

function divideOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function toDecimalString(value: number | null, digits = 2) {
  if (value == null) {
    return null;
  }

  return value.toFixed(digits);
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function formatPercentLabel(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function severityWeight(severity: AlertSeverity) {
  switch (severity) {
    case AlertSeverity.CRITICAL:
      return 90;
    case AlertSeverity.HIGH:
      return 70;
    case AlertSeverity.MEDIUM:
    default:
      return 50;
  }
}

function computeRankScore(severity: AlertSeverity, impactAmount: number | null, freshnessBoost = 0) {
  return roundRank(
    severityWeight(severity) + Math.min(Math.max(impactAmount ?? 0, 0), 9999) / 10 + freshnessBoost,
  );
}

function getDateKey(date: Date) {
  return date.toISOString();
}

function getExpiryDate(metricDate: Date) {
  return new Date(metricDate.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function getCompletenessForDate(
  completenessByDate: Map<string, CompletenessSnapshotInput>,
  metricDate: Date,
) {
  const snapshot = completenessByDate.get(getDateKey(metricDate));

  return {
    completenessLevel: snapshot?.level ?? DataCompletenessLevel.MEDIUM,
    confidenceLevel: snapshot?.level ?? DataCompletenessLevel.MEDIUM,
    snapshot,
  };
}

function buildLowMarginAlert(metric: DailyShopMetricInput, currencyCode: string): AlertCandidate | null {
  if (metric.grossMarginRate == null || metric.grossSalesAmount < 50 || metric.grossMarginRate >= 0.18) {
    return null;
  }

  const severity =
    metric.grossMarginRate < 0.1
      ? AlertSeverity.CRITICAL
      : metric.grossMarginRate < 0.14
        ? AlertSeverity.HIGH
        : AlertSeverity.MEDIUM;
  const impactAmount = roundMoney(Math.max(0.18 - metric.grossMarginRate, 0) * metric.grossSalesAmount);

  return {
    alertType: "SHOP_LOW_MARGIN",
    severity,
    entityType: "SHOP",
    entityKey: "shop",
    title: `Gross margin dropped to ${formatPercentLabel(metric.grossMarginRate)}`,
    impactAmount,
    currencyCode,
    confidenceLevel: metric.completenessLevel,
    completenessLevel: metric.completenessLevel,
    detectedForDate: metric.metricDate,
    firstDetectedAt: metric.metricDate,
    lastDetectedAt: metric.metricDate,
    expiresAt: getExpiryDate(metric.metricDate),
    rankScore: computeRankScore(severity, impactAmount, 5),
    rulePayload: {
      grossMarginRate: metric.grossMarginRate,
      threshold: 0.18,
      grossSalesAmount: metric.grossSalesAmount,
      grossProfitBeforeAdSpend: metric.grossProfitBeforeAdSpend,
    },
  };
}

function buildHighRefundAlert(metric: DailyShopMetricInput, currencyCode: string): AlertCandidate | null {
  if (metric.refundRate == null || metric.refundAmount <= 0 || metric.refundRate < 0.08) {
    return null;
  }

  const severity =
    metric.refundRate >= 0.18
      ? AlertSeverity.CRITICAL
      : metric.refundRate >= 0.12
        ? AlertSeverity.HIGH
        : AlertSeverity.MEDIUM;
  const impactAmount = roundMoney(metric.refundAmount);

  return {
    alertType: "SHOP_HIGH_REFUND_RATE",
    severity,
    entityType: "SHOP",
    entityKey: "shop",
    title: `Refund rate reached ${formatPercentLabel(metric.refundRate)}`,
    impactAmount,
    currencyCode,
    confidenceLevel: metric.completenessLevel,
    completenessLevel: metric.completenessLevel,
    detectedForDate: metric.metricDate,
    firstDetectedAt: metric.metricDate,
    lastDetectedAt: metric.metricDate,
    expiresAt: getExpiryDate(metric.metricDate),
    rankScore: computeRankScore(severity, impactAmount, 4),
    rulePayload: {
      refundRate: metric.refundRate,
      threshold: 0.08,
      refundAmount: metric.refundAmount,
      ordersCount: metric.ordersCount,
    },
  };
}

function buildHighDiscountAlert(metric: DailyShopMetricInput, currencyCode: string): AlertCandidate | null {
  if (metric.discountRate == null || metric.discountAmount <= 0 || metric.discountRate < 0.12) {
    return null;
  }

  const severity =
    metric.discountRate >= 0.25
      ? AlertSeverity.CRITICAL
      : metric.discountRate >= 0.18
        ? AlertSeverity.HIGH
        : AlertSeverity.MEDIUM;

  return {
    alertType: "SHOP_HIGH_DISCOUNT_RATE",
    severity,
    entityType: "SHOP",
    entityKey: "shop",
    title: `Discount share climbed to ${formatPercentLabel(metric.discountRate)}`,
    impactAmount: roundMoney(metric.discountAmount),
    currencyCode,
    confidenceLevel: metric.completenessLevel,
    completenessLevel: metric.completenessLevel,
    detectedForDate: metric.metricDate,
    firstDetectedAt: metric.metricDate,
    lastDetectedAt: metric.metricDate,
    expiresAt: getExpiryDate(metric.metricDate),
    rankScore: computeRankScore(severity, metric.discountAmount, 3),
    rulePayload: {
      discountRate: metric.discountRate,
      discountAmount: metric.discountAmount,
      threshold: 0.12,
      grossSalesAmount: metric.grossSalesAmount,
    },
  };
}

function buildHighShippingCostAlert(metric: DailyShopMetricInput, currencyCode: string): AlertCandidate | null {
  if (
    metric.averageOrderShippingCost == null ||
    metric.ordersCount < 3 ||
    metric.averageOrderShippingCost < 8
  ) {
    return null;
  }

  const severity =
    metric.averageOrderShippingCost >= 14
      ? AlertSeverity.CRITICAL
      : metric.averageOrderShippingCost >= 10
        ? AlertSeverity.HIGH
        : AlertSeverity.MEDIUM;
  const impactAmount = roundMoney(Math.max(metric.averageOrderShippingCost - 8, 0) * metric.ordersCount);

  return {
    alertType: "SHOP_HIGH_SHIPPING_COST",
    severity,
    entityType: "SHOP",
    entityKey: "shop",
    title: `Average shipping cost reached ${metric.averageOrderShippingCost.toFixed(2)}`,
    impactAmount,
    currencyCode,
    confidenceLevel: metric.completenessLevel,
    completenessLevel: metric.completenessLevel,
    detectedForDate: metric.metricDate,
    firstDetectedAt: metric.metricDate,
    lastDetectedAt: metric.metricDate,
    expiresAt: getExpiryDate(metric.metricDate),
    rankScore: computeRankScore(severity, impactAmount, 3),
    rulePayload: {
      averageOrderShippingCost: metric.averageOrderShippingCost,
      shippingCostEstimateAmount: metric.shippingCostEstimateAmount,
      threshold: 8,
      ordersCount: metric.ordersCount,
    },
  };
}

function buildLowCompletenessAlert(snapshot: CompletenessSnapshotInput): AlertCandidate | null {
  if (snapshot.level !== DataCompletenessLevel.LOW) {
    return null;
  }

  const missingCoverage = Math.max(
    1 - (snapshot.variantCoverageRate ?? 0),
    1 - (snapshot.orderCoverageRate ?? 0),
  );
  const impactAmount = roundMoney(missingCoverage * 100);

  return {
    alertType: "SHOP_LOW_COMPLETENESS",
    severity: AlertSeverity.HIGH,
    entityType: "SHOP",
    entityKey: "shop",
    title: "Data completeness dropped to LOW",
    impactAmount,
    currencyCode: null,
    confidenceLevel: DataCompletenessLevel.LOW,
    completenessLevel: snapshot.level,
    detectedForDate: snapshot.snapshotDate,
    firstDetectedAt: snapshot.snapshotDate,
    lastDetectedAt: snapshot.snapshotDate,
    expiresAt: getExpiryDate(snapshot.snapshotDate),
    rankScore: computeRankScore(AlertSeverity.HIGH, impactAmount, 6),
    rulePayload: {
      level: snapshot.level,
      variantCoverageRate: snapshot.variantCoverageRate,
      orderCoverageRate: snapshot.orderCoverageRate,
      payload: snapshot.payload,
    },
  };
}

function buildPromoLowMarginAlert(metric: DailyShopMetricInput, currencyCode: string): AlertCandidate | null {
  if (
    metric.discountRate == null ||
    metric.grossMarginRate == null ||
    metric.discountRate < 0.12 ||
    metric.grossMarginRate >= 0.12
  ) {
    return null;
  }

  const severity =
    metric.grossMarginRate < 0.08
      ? AlertSeverity.CRITICAL
      : metric.grossMarginRate < 0.1
        ? AlertSeverity.HIGH
        : AlertSeverity.MEDIUM;
  const impactAmount = roundMoney(Math.max(0.15 - metric.grossMarginRate, 0) * metric.grossSalesAmount);

  return {
    alertType: "PROMO_LOW_MARGIN",
    severity,
    entityType: "SHOP",
    entityKey: "shop",
    title: `Promo-day margin fell to ${formatPercentLabel(metric.grossMarginRate)}`,
    impactAmount,
    currencyCode,
    confidenceLevel: metric.completenessLevel,
    completenessLevel: metric.completenessLevel,
    detectedForDate: metric.metricDate,
    firstDetectedAt: metric.metricDate,
    lastDetectedAt: metric.metricDate,
    expiresAt: getExpiryDate(metric.metricDate),
    rankScore: computeRankScore(severity, impactAmount, 4),
    rulePayload: {
      grossMarginRate: metric.grossMarginRate,
      discountRate: metric.discountRate,
      discountAmount: metric.discountAmount,
      threshold: 0.12,
    },
  };
}

function buildGmvUpMarginFlatAlerts(shopMetrics: DailyShopMetricInput[], currencyCode: string) {
  const candidates: AlertCandidate[] = [];

  for (let index = 1; index < shopMetrics.length; index += 1) {
    const previous = shopMetrics[index - 1];
    const current = shopMetrics[index];

    if (
      previous == null ||
      previous.grossSalesAmount < 50 ||
      current.grossSalesAmount < previous.grossSalesAmount * 1.2
    ) {
      continue;
    }

    const currentMargin = current.grossMarginRate;
    const previousMargin = previous.grossMarginRate;
    const marginDelta =
      currentMargin != null && previousMargin != null ? currentMargin - previousMargin : null;
    const grossProfitFlat =
      current.grossProfitBeforeAdSpend <= previous.grossProfitBeforeAdSpend * 1.05;

    if (!grossProfitFlat && (marginDelta == null || marginDelta > -0.05)) {
      continue;
    }

    const severity =
      currentMargin != null && currentMargin < 0.08
        ? AlertSeverity.CRITICAL
        : currentMargin != null && currentMargin < 0.12
          ? AlertSeverity.HIGH
          : AlertSeverity.MEDIUM;
    const impactAmount = roundMoney(
      Math.max(current.grossSalesAmount * 0.18 - current.grossProfitBeforeAdSpend, 0),
    );

    candidates.push({
      alertType: "SHOP_GMV_UP_MARGIN_FLAT",
      severity,
      entityType: "SHOP",
      entityKey: "shop",
      title: "GMV increased, but gross profit did not keep up",
      impactAmount,
      currencyCode,
      confidenceLevel: current.completenessLevel,
      completenessLevel: current.completenessLevel,
      detectedForDate: current.metricDate,
      firstDetectedAt: current.metricDate,
      lastDetectedAt: current.metricDate,
      expiresAt: getExpiryDate(current.metricDate),
      rankScore: computeRankScore(severity, impactAmount, 5),
      rulePayload: {
        currentGrossSalesAmount: current.grossSalesAmount,
        currentGrossProfitBeforeAdSpend: current.grossProfitBeforeAdSpend,
        currentGrossMarginRate: currentMargin,
        previousGrossSalesAmount: previous.grossSalesAmount,
        previousGrossProfitBeforeAdSpend: previous.grossProfitBeforeAdSpend,
        previousGrossMarginRate: previousMargin,
        marginDeltaRate: marginDelta,
      },
    });
  }

  return candidates;
}

function buildChannelLowMarginAlerts(
  channelMetrics: DailyChannelMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return channelMetrics
    .filter(
      (metric) =>
        metric.ordersCount >= 2 &&
        metric.grossSalesAmount >= 100 &&
        metric.grossMarginRate != null &&
        metric.grossMarginRate < 0.12,
    )
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.grossMarginRate != null && metric.grossMarginRate < 0.06
          ? AlertSeverity.CRITICAL
          : metric.grossMarginRate != null && metric.grossMarginRate < 0.1
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
      const impactAmount = roundMoney(
        Math.max(metric.grossSalesAmount * 0.18 - metric.grossProfitBeforeAdSpend, 0),
      );

      return {
        alertType: "CHANNEL_LOW_MARGIN",
        severity,
        entityType: "CHANNEL",
        entityKey: metric.channelKey,
        title: `Channel ${metric.channelKey} ran at ${formatPercentLabel(metric.grossMarginRate)} margin`,
        impactAmount,
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, impactAmount, 3),
        rulePayload: {
          channelKey: metric.channelKey,
          grossMarginRate: metric.grossMarginRate,
          grossSalesAmount: metric.grossSalesAmount,
          grossProfitBeforeAdSpend: metric.grossProfitBeforeAdSpend,
          threshold: 0.12,
        },
      } satisfies AlertCandidate;
    });
}

function buildSourceLowMarginAlerts(
  sourceMetrics: DailySourceMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return sourceMetrics
    .filter(
      (metric) =>
        metric.ordersCount >= 2 &&
        metric.grossSalesAmount >= 80 &&
        metric.grossMarginRate != null &&
        metric.grossMarginRate < 0.12 &&
        metric.sourceKey !== "unknown",
    )
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.grossMarginRate != null && metric.grossMarginRate < 0.06
          ? AlertSeverity.CRITICAL
          : metric.grossMarginRate != null && metric.grossMarginRate < 0.09
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
      const impactAmount = roundMoney(
        Math.max(metric.grossSalesAmount * 0.18 - metric.grossProfitBeforeAdSpend, 0),
      );

      return {
        alertType: "SOURCE_LOW_MARGIN",
        severity,
        entityType: "SOURCE",
        entityKey: metric.sourceKey,
        title: `Source ${metric.sourceKey} concentrated low-margin orders`,
        impactAmount,
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, impactAmount, 3),
        rulePayload: {
          sourceKey: metric.sourceKey,
          grossMarginRate: metric.grossMarginRate,
          grossSalesAmount: metric.grossSalesAmount,
          grossProfitBeforeAdSpend: metric.grossProfitBeforeAdSpend,
        },
      } satisfies AlertCandidate;
    });
}

function buildRegionHighRefundAlerts(
  regionMetrics: DailyRegionMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return regionMetrics
    .filter(
      (metric) =>
        metric.countryCode !== "UNKNOWN" &&
        metric.ordersCount >= 2 &&
        metric.refundRate != null &&
        metric.refundRate >= 0.1,
    )
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.refundRate != null && metric.refundRate >= 0.2
          ? AlertSeverity.CRITICAL
          : metric.refundRate != null && metric.refundRate >= 0.14
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;

      return {
        alertType: "REGION_HIGH_REFUND_RATE",
        severity,
        entityType: "REGION",
        entityKey: metric.countryCode,
        title: `Region ${metric.countryCode} refund rate reached ${formatPercentLabel(metric.refundRate)}`,
        impactAmount: roundMoney(metric.refundAmount),
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, metric.refundAmount, 2),
        rulePayload: {
          countryCode: metric.countryCode,
          refundRate: metric.refundRate,
          refundAmount: metric.refundAmount,
          ordersCount: metric.ordersCount,
        },
      } satisfies AlertCandidate;
    });
}

function buildRegionHighShippingAlerts(
  regionMetrics: DailyRegionMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return regionMetrics
    .filter(
      (metric) =>
        metric.countryCode !== "UNKNOWN" &&
        metric.ordersCount >= 2 &&
        metric.averageOrderShippingCost != null &&
        metric.averageOrderShippingCost >= 10,
    )
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.averageOrderShippingCost != null && metric.averageOrderShippingCost >= 16
          ? AlertSeverity.CRITICAL
          : metric.averageOrderShippingCost != null && metric.averageOrderShippingCost >= 12
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;
      const impactAmount = roundMoney(
        Math.max((metric.averageOrderShippingCost ?? 0) - 8, 0) * metric.ordersCount,
      );

      return {
        alertType: "REGION_HIGH_SHIPPING_COST",
        severity,
        entityType: "REGION",
        entityKey: metric.countryCode,
        title: `Region ${metric.countryCode} shipping cost reached ${metric.averageOrderShippingCost?.toFixed(2) ?? "n/a"}`,
        impactAmount,
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, impactAmount, 2),
        rulePayload: {
          countryCode: metric.countryCode,
          averageOrderShippingCost: metric.averageOrderShippingCost,
          shippingCostAmount: metric.shippingCostAmount,
          ordersCount: metric.ordersCount,
        },
      } satisfies AlertCandidate;
    });
}

function buildNegativeSkuAlerts(
  skuMetrics: DailySkuMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return skuMetrics
    .filter((metric) => metric.grossProfitBeforeAdSpend < 0 && metric.grossSalesAmount > 0)
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.grossProfitBeforeAdSpend <= -50 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH;
      const impactAmount = roundMoney(Math.abs(metric.grossProfitBeforeAdSpend));

      return {
        alertType: "SKU_NEGATIVE_MARGIN",
        severity,
        entityType: "SKU",
        entityKey: metric.variantId ?? metric.sku ?? `untracked:${metric.metricDate.toISOString()}`,
        title: `SKU ${metric.sku || "Unknown SKU"} turned negative`,
        impactAmount,
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, impactAmount, 3),
        rulePayload: {
          sku: metric.sku,
          variantId: metric.variantId,
          grossProfitBeforeAdSpend: metric.grossProfitBeforeAdSpend,
          grossMarginRate: metric.grossMarginRate,
          grossSalesAmount: metric.grossSalesAmount,
          quantitySold: metric.quantitySold,
        },
      } satisfies AlertCandidate;
    });
}

function buildSkuMarginDropAlerts(
  skuMetrics: DailySkuMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  const metricsBySku = new Map<string, DailySkuMetricInput[]>();

  for (const metric of skuMetrics) {
    const entityKey = metric.variantId ?? metric.sku ?? `unknown:${metric.metricDate.toISOString()}`;
    const list = metricsBySku.get(entityKey) ?? [];
    list.push(metric);
    metricsBySku.set(entityKey, list);
  }

  const candidates: AlertCandidate[] = [];

  for (const [entityKey, metrics] of metricsBySku.entries()) {
    metrics.sort((left, right) => left.metricDate.getTime() - right.metricDate.getTime());

    for (let index = 1; index < metrics.length; index += 1) {
      const previous = metrics[index - 1];
      const current = metrics[index];

      if (
        previous?.grossMarginRate == null ||
        current?.grossMarginRate == null ||
        current.grossSalesAmount < 50
      ) {
        continue;
      }

      const marginDrop = previous.grossMarginRate - current.grossMarginRate;

      if (marginDrop < 0.15 || current.grossMarginRate >= previous.grossMarginRate) {
        continue;
      }

      const completeness = getCompletenessForDate(completenessByDate, current.metricDate);
      const severity =
        marginDrop >= 0.3 ? AlertSeverity.CRITICAL : marginDrop >= 0.2 ? AlertSeverity.HIGH : AlertSeverity.MEDIUM;
      const impactAmount = roundMoney(Math.max(marginDrop, 0) * current.grossSalesAmount);

      candidates.push({
        alertType: "SKU_MARGIN_DROP",
        severity,
        entityType: "SKU",
        entityKey,
        title: `SKU ${current.sku || entityKey} margin dropped by ${formatPercentLabel(marginDrop)}`,
        impactAmount,
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: current.metricDate,
        firstDetectedAt: current.metricDate,
        lastDetectedAt: current.metricDate,
        expiresAt: getExpiryDate(current.metricDate),
        rankScore: computeRankScore(severity, impactAmount, 4),
        rulePayload: {
          sku: current.sku,
          variantId: current.variantId,
          currentGrossMarginRate: current.grossMarginRate,
          previousGrossMarginRate: previous.grossMarginRate,
          marginDropRate: marginDrop,
          grossSalesAmount: current.grossSalesAmount,
        },
      });
    }
  }

  return candidates;
}

function buildSkuDeepDiscountAlerts(
  skuMetrics: DailySkuMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  return skuMetrics
    .map((metric) => ({
      ...metric,
      discountRate: roundRate(divideOrNull(metric.discountAmount, metric.grossSalesAmount)),
    }))
    .filter(
      (metric) =>
        metric.quantitySold >= 3 &&
        metric.grossSalesAmount >= 60 &&
        metric.discountRate != null &&
        metric.discountRate >= 0.18,
    )
    .map((metric) => {
      const completeness = getCompletenessForDate(completenessByDate, metric.metricDate);
      const severity =
        metric.discountRate != null && metric.discountRate >= 0.3
          ? AlertSeverity.CRITICAL
          : metric.discountRate != null && metric.discountRate >= 0.22
            ? AlertSeverity.HIGH
            : AlertSeverity.MEDIUM;

      return {
        alertType: "SKU_DEEP_DISCOUNT",
        severity,
        entityType: "SKU",
        entityKey: metric.variantId ?? metric.sku ?? `untracked:${metric.metricDate.toISOString()}`,
        title: `SKU ${metric.sku || "Unknown SKU"} discount depth reached ${formatPercentLabel(metric.discountRate ?? null)}`,
        impactAmount: roundMoney(metric.discountAmount),
        currencyCode,
        confidenceLevel: completeness.confidenceLevel,
        completenessLevel: completeness.completenessLevel,
        detectedForDate: metric.metricDate,
        firstDetectedAt: metric.metricDate,
        lastDetectedAt: metric.metricDate,
        expiresAt: getExpiryDate(metric.metricDate),
        rankScore: computeRankScore(severity, metric.discountAmount, 2),
        rulePayload: {
          sku: metric.sku,
          variantId: metric.variantId,
          discountRate: metric.discountRate,
          discountAmount: metric.discountAmount,
          quantitySold: metric.quantitySold,
          grossSalesAmount: metric.grossSalesAmount,
        },
      } satisfies AlertCandidate;
    });
}

function buildOrderMixShiftAlerts(
  skuMetrics: DailySkuMetricInput[],
  currencyCode: string,
  completenessByDate: Map<string, CompletenessSnapshotInput>,
) {
  const shareByDate = new Map<
    string,
    {
      metricDate: Date;
      totalSales: number;
      lowMarginSales: number;
    }
  >();

  for (const metric of skuMetrics) {
    const key = getDateKey(metric.metricDate);
    const entry = shareByDate.get(key) ?? {
      metricDate: metric.metricDate,
      totalSales: 0,
      lowMarginSales: 0,
    };

    entry.totalSales += metric.grossSalesAmount;

    if (metric.grossMarginRate != null && metric.grossMarginRate < 0.18) {
      entry.lowMarginSales += metric.grossSalesAmount;
    }

    shareByDate.set(key, entry);
  }

  const sortedShares = [...shareByDate.values()].sort(
    (left, right) => left.metricDate.getTime() - right.metricDate.getTime(),
  );
  const candidates: AlertCandidate[] = [];

  for (let index = 1; index < sortedShares.length; index += 1) {
    const previous = sortedShares[index - 1];
    const current = sortedShares[index];
    const previousShare = divideOrNull(previous.lowMarginSales, previous.totalSales);
    const currentShare = divideOrNull(current.lowMarginSales, current.totalSales);

    if (
      previousShare == null ||
      currentShare == null ||
      current.totalSales < 150 ||
      currentShare < 0.45 ||
      currentShare - previousShare < 0.2
    ) {
      continue;
    }

    const shareDelta = currentShare - previousShare;
    const completeness = getCompletenessForDate(completenessByDate, current.metricDate);
    const severity =
      shareDelta >= 0.35 ? AlertSeverity.CRITICAL : shareDelta >= 0.25 ? AlertSeverity.HIGH : AlertSeverity.MEDIUM;
    const impactAmount = roundMoney(shareDelta * current.totalSales);

    candidates.push({
      alertType: "ORDER_MIX_LOW_MARGIN",
      severity,
      entityType: "SHOP",
      entityKey: "shop",
      title: "Order mix shifted toward low-margin products",
      impactAmount,
      currencyCode,
      confidenceLevel: completeness.confidenceLevel,
      completenessLevel: completeness.completenessLevel,
      detectedForDate: current.metricDate,
      firstDetectedAt: current.metricDate,
      lastDetectedAt: current.metricDate,
      expiresAt: getExpiryDate(current.metricDate),
      rankScore: computeRankScore(severity, impactAmount, 3),
      rulePayload: {
        currentLowMarginSalesShare: currentShare,
        previousLowMarginSalesShare: previousShare,
        lowMarginSalesShareDelta: shareDelta,
        currentTotalSales: current.totalSales,
      },
    });
  }

  return candidates;
}

export function evaluateAlertCandidates(args: {
  bundle: DailyMetricsBundle;
  currencyCode: string;
}) {
  const completenessByDate = new Map(
    args.bundle.completenessSnapshots.map((snapshot) => [getDateKey(snapshot.snapshotDate), snapshot]),
  );
  const candidates: AlertCandidate[] = [];

  for (const metric of args.bundle.shopMetrics) {
    const lowMarginAlert = buildLowMarginAlert(metric, args.currencyCode);
    const highRefundAlert = buildHighRefundAlert(metric, args.currencyCode);
    const highDiscountAlert = buildHighDiscountAlert(metric, args.currencyCode);
    const highShippingAlert = buildHighShippingCostAlert(metric, args.currencyCode);
    const promoLowMarginAlert = buildPromoLowMarginAlert(metric, args.currencyCode);
    const completenessAlert =
      completenessByDate.get(getDateKey(metric.metricDate)) != null
        ? buildLowCompletenessAlert(
            completenessByDate.get(getDateKey(metric.metricDate)) as CompletenessSnapshotInput,
          )
        : null;

    if (lowMarginAlert) {
      candidates.push(lowMarginAlert);
    }

    if (highRefundAlert) {
      candidates.push(highRefundAlert);
    }

    if (highDiscountAlert) {
      candidates.push(highDiscountAlert);
    }

    if (highShippingAlert) {
      candidates.push(highShippingAlert);
    }

    if (promoLowMarginAlert) {
      candidates.push(promoLowMarginAlert);
    }

    if (completenessAlert) {
      candidates.push(completenessAlert);
    }
  }

  candidates.push(...buildGmvUpMarginFlatAlerts(args.bundle.shopMetrics, args.currencyCode));
  candidates.push(
    ...buildChannelLowMarginAlerts(args.bundle.channelMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildSourceLowMarginAlerts(args.bundle.sourceMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildRegionHighRefundAlerts(args.bundle.regionMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildRegionHighShippingAlerts(args.bundle.regionMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildNegativeSkuAlerts(args.bundle.skuMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildSkuMarginDropAlerts(args.bundle.skuMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildSkuDeepDiscountAlerts(args.bundle.skuMetrics, args.currencyCode, completenessByDate),
  );
  candidates.push(
    ...buildOrderMixShiftAlerts(args.bundle.skuMetrics, args.currencyCode, completenessByDate),
  );

  return candidates.sort((left, right) => right.rankScore - left.rankScore);
}

function alertThreadKey(candidate: {
  alertType: string;
  entityType: string;
  entityKey: string;
}) {
  return `${candidate.alertType}::${candidate.entityType}::${candidate.entityKey}`;
}

export async function syncManagedAlertsForBundle(args: {
  tx: Prisma.TransactionClient;
  shopId: string;
  bundle: DailyMetricsBundle;
  currencyCode: string;
}) {
  const detectedDates = [
    ...new Set(args.bundle.shopMetrics.map((metric) => metric.metricDate.toISOString())),
  ].map((value) => new Date(value));
  const candidates = evaluateAlertCandidates({
    bundle: args.bundle,
    currencyCode: args.currencyCode,
  });

  const existingAlerts = detectedDates.length
    ? await args.tx.alert.findMany({
        where: {
          shopId: args.shopId,
          alertType: {
            in: [...MANAGED_ALERT_TYPES],
          },
          detectedForDate: {
            in: detectedDates,
          },
        },
        select: {
          threadId: true,
          alertType: true,
          entityType: true,
          entityKey: true,
        },
      })
    : [];

  const touchedThreadIds = new Set(
    existingAlerts.map((alert) => alert.threadId).filter((value): value is string => Boolean(value)),
  );
  const touchedKeys = new Set(
    existingAlerts.map((alert) => alertThreadKey(alert)).concat(candidates.map((candidate) => alertThreadKey(candidate))),
  );

  if (detectedDates.length > 0) {
    await args.tx.alert.deleteMany({
      where: {
        shopId: args.shopId,
        alertType: {
          in: [...MANAGED_ALERT_TYPES],
        },
        detectedForDate: {
          in: detectedDates,
        },
      },
    });
  }

  const existingThreads = touchedKeys.size
    ? await args.tx.alertThread.findMany({
        where: {
          shopId: args.shopId,
          OR: [...touchedKeys].map((key) => {
            const [alertType, entityType, entityKey] = key.split("::");
            return {
              alertType,
              entityType,
              entityKey,
            };
          }),
        },
      })
    : [];
  const threadByKey = new Map(existingThreads.map((thread) => [alertThreadKey(thread), thread]));

  for (const candidate of candidates) {
    const key = alertThreadKey(candidate);
    let thread = threadByKey.get(key);

    if (!thread) {
      thread = await args.tx.alertThread.create({
        data: {
          shopId: args.shopId,
          alertType: candidate.alertType,
          entityType: candidate.entityType,
          entityKey: candidate.entityKey,
          isOpen: true,
          firstDetectedAt: candidate.detectedForDate,
          lastDetectedAt: candidate.detectedForDate,
        },
      });

      threadByKey.set(key, thread);
    }

    const alert = await args.tx.alert.create({
      data: {
        shopId: args.shopId,
        threadId: thread.id,
        alertType: candidate.alertType,
        severity: candidate.severity,
        status: AlertStatus.NEW,
        entityType: candidate.entityType,
        entityKey: candidate.entityKey,
        title: candidate.title,
        impactAmount: toDecimalString(candidate.impactAmount),
        currencyCode: candidate.currencyCode,
        confidenceLevel: candidate.confidenceLevel,
        completenessLevel: candidate.completenessLevel,
        detectedForDate: candidate.detectedForDate,
        firstDetectedAt: candidate.firstDetectedAt,
        lastDetectedAt: candidate.lastDetectedAt,
        expiresAt: candidate.expiresAt,
        rankScore: candidate.rankScore.toFixed(4),
        rulePayload: toJsonValue(candidate.rulePayload),
      },
    });

    touchedThreadIds.add(thread.id);

    await args.tx.alertStatusHistory.create({
      data: {
        alertId: alert.id,
        fromStatus: null,
        toStatus: AlertStatus.NEW,
        note: "Detected during daily rebuild",
        actorType: "system",
        actorId: "daily_rebuild",
      },
    });
  }

  for (const threadId of touchedThreadIds) {
    const threadAlerts = await args.tx.alert.findMany({
      where: {
        threadId,
      },
      select: {
        detectedForDate: true,
        status: true,
      },
      orderBy: {
        detectedForDate: "asc",
      },
    });

    if (threadAlerts.length === 0) {
      await args.tx.alertThread.delete({
        where: {
          id: threadId,
        },
      });
      continue;
    }

    await args.tx.alertThread.update({
      where: {
        id: threadId,
      },
      data: {
        firstDetectedAt: threadAlerts[0]?.detectedForDate ?? new Date(),
        lastDetectedAt: threadAlerts[threadAlerts.length - 1]?.detectedForDate ?? new Date(),
        isOpen: threadAlerts.some((alert) => alert.status !== AlertStatus.RESOLVED && alert.status !== AlertStatus.IGNORED),
      },
    });
  }

  return {
    alertsGenerated: candidates.length,
    datesEvaluated: detectedDates.length,
  };
}
