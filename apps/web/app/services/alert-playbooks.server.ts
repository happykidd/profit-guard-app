type AlertBriefMetric = {
  label: string;
  value: string;
};

export type AlertBrief = {
  summary: string;
  whyItMatters: string;
  primaryAction: string;
  checks: string[];
  metrics: AlertBriefMetric[];
};

type AlertBriefInput = {
  alertType: string;
  entityType: string;
  entityKey: string;
  title: string;
  severity: string;
  confidenceLevel?: string | null;
  completenessLevel?: string | null;
  impactAmount?: string | number | null;
  currencyCode?: string | null;
  rulePayload?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNumber(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function readString(source: Record<string, unknown> | null, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatPercent(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number | null, currencyCode = "USD") {
  if (value == null) {
    return "n/a";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatImpact(input: AlertBriefInput) {
  const numericValue =
    typeof input.impactAmount === "number"
      ? input.impactAmount
      : typeof input.impactAmount === "string"
        ? Number(input.impactAmount)
        : null;

  return Number.isFinite(numericValue) ? formatCurrency(numericValue, input.currencyCode || "USD") : "n/a";
}

function buildLowMarginBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const grossMarginRate = readNumber(payload, "grossMarginRate");
  const threshold = readNumber(payload, "threshold");
  const grossSalesAmount = readNumber(payload, "grossSalesAmount");
  const grossProfitBeforeAdSpend = readNumber(payload, "grossProfitBeforeAdSpend");
  const marginGap =
    grossMarginRate != null && threshold != null ? Math.max(threshold - grossMarginRate, 0) : null;

  return {
    summary: `Store margin is running at ${formatPercent(grossMarginRate)}, below the guardrail of ${formatPercent(threshold)}.`,
    whyItMatters:
      "Weak margin leaves very little room for shipping leakage, paid acquisition, or unexpected refunds before the day turns unprofitable.",
    primaryAction:
      "Audit discounting, shipping leakage, and the top low-margin SKUs for the affected day before scaling spend.",
    checks: [
      "Compare promo/discount activity against the previous 7 days and look for stacked offers.",
      "Review the SKUs contributing most to the day's sales and confirm their cost source is direct rather than fallback.",
      "If shipping or fees are temporarily elevated, rerun the daily rebuild after missing costs are fixed.",
    ],
    metrics: [
      {
        label: "Observed margin",
        value: formatPercent(grossMarginRate),
      },
      {
        label: "Threshold",
        value: formatPercent(threshold),
      },
      {
        label: "Margin gap",
        value: formatPercent(marginGap),
      },
      {
        label: "Gross sales",
        value: formatCurrency(grossSalesAmount, input.currencyCode || "USD"),
      },
      {
        label: "Gross profit",
        value: formatCurrency(grossProfitBeforeAdSpend, input.currencyCode || "USD"),
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildRefundBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const refundRate = readNumber(payload, "refundRate");
  const threshold = readNumber(payload, "threshold");
  const refundAmount = readNumber(payload, "refundAmount");
  const ordersCount = readNumber(payload, "ordersCount");

  return {
    summary: `Refund rate climbed to ${formatPercent(refundRate)}, above the alert threshold of ${formatPercent(threshold)}.`,
    whyItMatters:
      "Refund spikes erode realized profit quickly and often signal fulfillment defects, product-quality issues, or expectation mismatch on high-volume SKUs.",
    primaryAction:
      "Pull the refunded orders for the day, cluster by SKU and refund reason, and check whether one product or campaign is driving the loss.",
    checks: [
      "Review refund notes and support tickets for fulfillment delay or quality patterns.",
      "Compare refunded SKUs with the day's top sellers to isolate where margin is leaking.",
      "If one SKU dominates refunds, consider pausing ads or promotions until the cause is understood.",
    ],
    metrics: [
      {
        label: "Observed refund rate",
        value: formatPercent(refundRate),
      },
      {
        label: "Threshold",
        value: formatPercent(threshold),
      },
      {
        label: "Refund amount",
        value: formatCurrency(refundAmount, input.currencyCode || "USD"),
      },
      {
        label: "Orders affected day",
        value: ordersCount != null ? String(Math.round(ordersCount)) : "n/a",
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildCompletenessBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const variantCoverageRate = readNumber(payload, "variantCoverageRate");
  const orderCoverageRate = readNumber(payload, "orderCoverageRate");

  return {
    summary: `Profit coverage fell to ${input.completenessLevel || "LOW"}, so part of the day's result is still based on incomplete data.`,
    whyItMatters:
      "When completeness is low, other alerts become less trustworthy because missing product costs or order coverage can distort both margin and refund interpretation.",
    primaryAction:
      "Backfill missing costs first, then rerun the daily rebuild before making pricing or campaign decisions from this day's profit signals.",
    checks: [
      "Open Cost Center and fill the missing variant costs highlighted for this store.",
      "Confirm recent orders have expected line-item cost coverage and no broken imports.",
      "Use this alert as a data-quality blocker before acting on other profitability alerts.",
    ],
    metrics: [
      {
        label: "Variant coverage",
        value: formatPercent(variantCoverageRate),
      },
      {
        label: "Order coverage",
        value: formatPercent(orderCoverageRate),
      },
      {
        label: "Confidence level",
        value: input.confidenceLevel || "n/a",
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildNegativeSkuBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const sku = readString(payload, "sku") || input.entityKey;
  const grossProfitBeforeAdSpend = readNumber(payload, "grossProfitBeforeAdSpend");
  const grossMarginRate = readNumber(payload, "grossMarginRate");
  const grossSalesAmount = readNumber(payload, "grossSalesAmount");
  const quantitySold = readNumber(payload, "quantitySold");

  return {
    summary: `SKU ${sku} generated negative contribution, with margin at ${formatPercent(grossMarginRate)} for the flagged day.`,
    whyItMatters:
      "A negative-margin SKU can quietly absorb profit from otherwise healthy orders, especially when discounts stack on top of stale or missing cost inputs.",
    primaryAction:
      "Inspect this SKU's active cost source, price, and discounting before the next campaign sends more volume through it.",
    checks: [
      "Compare current direct cost against category fallback and confirm the cost source is still accurate.",
      "Check whether the SKU was part of a promotion or bundle that pushed contribution below zero.",
      "If the margin issue is real, reprice, pause, or exclude the SKU from paid traffic until corrected.",
    ],
    metrics: [
      {
        label: "SKU",
        value: sku,
      },
      {
        label: "Observed margin",
        value: formatPercent(grossMarginRate),
      },
      {
        label: "Gross profit",
        value: formatCurrency(grossProfitBeforeAdSpend, input.currencyCode || "USD"),
      },
      {
        label: "Gross sales",
        value: formatCurrency(grossSalesAmount, input.currencyCode || "USD"),
      },
      {
        label: "Quantity sold",
        value: quantitySold != null ? String(Math.round(quantitySold)) : "n/a",
      },
    ],
  };
}

function buildDiscountBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const discountRate = readNumber(payload, "discountRate");
  const discountAmount = readNumber(payload, "discountAmount");
  const threshold = readNumber(payload, "threshold");

  return {
    summary: `Discount share reached ${formatPercent(discountRate)}, above the working threshold of ${formatPercent(threshold)}.`,
    whyItMatters:
      "Deep discounting can make GMV look healthy while quietly eroding contribution margin, especially when it lands on already low-margin products.",
    primaryAction:
      "Review which SKUs, channels, or campaigns absorbed the discount volume before letting the promo continue another cycle.",
    checks: [
      "Compare discount share against the previous 7 days and identify what changed.",
      "Check whether one SKU or one source tag carried most of the discounted volume.",
      "If discounting is strategic, verify that the bundle still clears the target margin floor.",
    ],
    metrics: [
      {
        label: "Observed discount share",
        value: formatPercent(discountRate),
      },
      {
        label: "Threshold",
        value: formatPercent(threshold),
      },
      {
        label: "Discount amount",
        value: formatCurrency(discountAmount, input.currencyCode || "USD"),
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildShippingBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const averageOrderShippingCost = readNumber(payload, "averageOrderShippingCost");
  const shippingCostEstimateAmount = readNumber(payload, "shippingCostEstimateAmount");
  const ordersCount = readNumber(payload, "ordersCount");

  return {
    summary: `Average shipping cost rose to ${formatCurrency(averageOrderShippingCost, input.currencyCode || "USD")} per order.`,
    whyItMatters:
      "Shipping leakage usually hits realized profit directly and is easy to miss when orders and GMV still look healthy.",
    primaryAction:
      "Pull the expensive orders, compare carrier/service level choices, and confirm the shipping estimate assumptions are still valid.",
    checks: [
      "Review whether one region or one service level is pushing shipping up.",
      "Compare actual shipping charges to what the customer paid at checkout.",
      "Re-check packaging, weight, and oversize logic on the SKUs in the affected orders.",
    ],
    metrics: [
      {
        label: "Avg shipping cost",
        value: formatCurrency(averageOrderShippingCost, input.currencyCode || "USD"),
      },
      {
        label: "Shipping estimate total",
        value: formatCurrency(shippingCostEstimateAmount, input.currencyCode || "USD"),
      },
      {
        label: "Orders counted",
        value: ordersCount != null ? String(Math.round(ordersCount)) : "n/a",
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildGmvProfitMismatchBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const currentGrossSalesAmount = readNumber(payload, "currentGrossSalesAmount");
  const currentGrossProfitBeforeAdSpend = readNumber(payload, "currentGrossProfitBeforeAdSpend");
  const currentGrossMarginRate = readNumber(payload, "currentGrossMarginRate");
  const previousGrossSalesAmount = readNumber(payload, "previousGrossSalesAmount");
  const previousGrossProfitBeforeAdSpend = readNumber(payload, "previousGrossProfitBeforeAdSpend");
  const marginDeltaRate = readNumber(payload, "marginDeltaRate");

  return {
    summary: "Sales volume increased, but gross profit did not scale with it.",
    whyItMatters:
      "This is the classic 'GMV up, profit flat' trap: more orders are coming in, but the mix, discounting, or leakage is offsetting the revenue gain.",
    primaryAction:
      "Break the day down by discounting, shipping leakage, and low-margin SKU mix before increasing spend further.",
    checks: [
      "Compare margin against the previous period and identify the main source of contraction.",
      "Check whether shipping, discounting, or refunds explain the profit drag.",
      "Look for a channel or source tag that scaled revenue faster than contribution.",
    ],
    metrics: [
      {
        label: "Current gross sales",
        value: formatCurrency(currentGrossSalesAmount, input.currencyCode || "USD"),
      },
      {
        label: "Current gross profit",
        value: formatCurrency(currentGrossProfitBeforeAdSpend, input.currencyCode || "USD"),
      },
      {
        label: "Previous gross sales",
        value: formatCurrency(previousGrossSalesAmount, input.currencyCode || "USD"),
      },
      {
        label: "Previous gross profit",
        value: formatCurrency(previousGrossProfitBeforeAdSpend, input.currencyCode || "USD"),
      },
      {
        label: "Current margin",
        value: formatPercent(currentGrossMarginRate),
      },
      {
        label: "Margin delta",
        value: formatPercent(marginDeltaRate),
      },
    ],
  };
}

function buildScopedMarginBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const grossMarginRate = readNumber(payload, "grossMarginRate");
  const grossSalesAmount = readNumber(payload, "grossSalesAmount");
  const grossProfitBeforeAdSpend = readNumber(payload, "grossProfitBeforeAdSpend");

  return {
    summary: `${input.entityType} ${input.entityKey} is carrying low-margin volume at ${formatPercent(grossMarginRate)}.`,
    whyItMatters:
      "A localized low-margin pocket often points to a specific channel, source, or campaign that needs intervention before it absorbs more spend.",
    primaryAction:
      "Inspect the affected scope's pricing, promo intensity, and product mix before scaling it further.",
    checks: [
      "Compare this scope against the store average for the same day.",
      "Check whether one SKU or one shipping profile explains the margin compression.",
      "If this scope is intentional, confirm its volume still supports the store-level profit target.",
    ],
    metrics: [
      {
        label: "Scope",
        value: `${input.entityType} / ${input.entityKey}`,
      },
      {
        label: "Observed margin",
        value: formatPercent(grossMarginRate),
      },
      {
        label: "Gross sales",
        value: formatCurrency(grossSalesAmount, input.currencyCode || "USD"),
      },
      {
        label: "Gross profit",
        value: formatCurrency(grossProfitBeforeAdSpend, input.currencyCode || "USD"),
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildSkuMarginDropBrief(input: AlertBriefInput, payload: Record<string, unknown> | null): AlertBrief {
  const sku = readString(payload, "sku") || input.entityKey;
  const currentGrossMarginRate = readNumber(payload, "currentGrossMarginRate");
  const previousGrossMarginRate = readNumber(payload, "previousGrossMarginRate");
  const marginDropRate = readNumber(payload, "marginDropRate");

  return {
    summary: `SKU ${sku} margin dropped from ${formatPercent(previousGrossMarginRate)} to ${formatPercent(currentGrossMarginRate)}.`,
    whyItMatters:
      "A fast margin drop on an existing SKU often signals cost drift, pricing drift, or a promotion that now clears too little contribution.",
    primaryAction:
      "Compare the current SKU setup against the previous healthy window and confirm cost, discount, and shipping assumptions are still correct.",
    checks: [
      "Look for cost-source changes or fallback rules that recently started applying.",
      "Check whether the SKU entered a deeper discount or bundle.",
      "Review shipping leakage if the SKU has weight or oversize characteristics.",
    ],
    metrics: [
      {
        label: "SKU",
        value: sku,
      },
      {
        label: "Previous margin",
        value: formatPercent(previousGrossMarginRate),
      },
      {
        label: "Current margin",
        value: formatPercent(currentGrossMarginRate),
      },
      {
        label: "Margin drop",
        value: formatPercent(marginDropRate),
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

function buildFallbackBrief(input: AlertBriefInput): AlertBrief {
  return {
    summary: input.title,
    whyItMatters:
      "This alert marks a profitability signal that needs review before you scale volume or make pricing changes.",
    primaryAction: "Open the alert detail, inspect the underlying payload, and confirm whether the signal is operational or data-quality driven.",
    checks: [
      "Verify the affected entity and date range are still current.",
      "Confirm completeness and cost inputs are trustworthy before acting.",
      "Leave a feedback note if this rule is too noisy so we can tune it later.",
    ],
    metrics: [
      {
        label: "Scope",
        value: `${input.entityType} / ${input.entityKey}`,
      },
      {
        label: "Severity",
        value: input.severity,
      },
      {
        label: "Estimated impact",
        value: formatImpact(input),
      },
    ],
  };
}

export function buildAlertBrief(input: AlertBriefInput): AlertBrief {
  const payload = asObject(input.rulePayload);

  switch (input.alertType) {
    case "SHOP_LOW_MARGIN":
      return buildLowMarginBrief(input, payload);
    case "SHOP_HIGH_REFUND_RATE":
      return buildRefundBrief(input, payload);
    case "SHOP_HIGH_DISCOUNT_RATE":
      return buildDiscountBrief(input, payload);
    case "SHOP_HIGH_SHIPPING_COST":
      return buildShippingBrief(input, payload);
    case "SHOP_GMV_UP_MARGIN_FLAT":
      return buildGmvProfitMismatchBrief(input, payload);
    case "SHOP_LOW_COMPLETENESS":
      return buildCompletenessBrief(input, payload);
    case "SKU_NEGATIVE_MARGIN":
      return buildNegativeSkuBrief(input, payload);
    case "CHANNEL_LOW_MARGIN":
    case "SOURCE_LOW_MARGIN":
    case "REGION_HIGH_REFUND_RATE":
    case "REGION_HIGH_SHIPPING_COST":
    case "PROMO_LOW_MARGIN":
      return buildScopedMarginBrief(input, payload);
    case "SKU_MARGIN_DROP":
    case "SKU_DEEP_DISCOUNT":
      return buildSkuMarginDropBrief(input, payload);
    default:
      return buildFallbackBrief(input);
  }
}
