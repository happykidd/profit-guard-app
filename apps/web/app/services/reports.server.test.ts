import assert from "node:assert/strict";
import test from "node:test";
import { DataCompletenessLevel, ReportType } from "@prisma/client";
import {
  buildReportPdfContent,
  buildDigestDeliverySubject,
  buildFallbackReportPayload,
  getAiReportGenerationConfig,
  renderReportExportContent,
} from "./reports.server";

test("buildFallbackReportPayload produces deterministic fallback summary", () => {
  const payload = buildFallbackReportPayload({
    alerts: [
      {
        alertType: "SHOP_LOW_MARGIN",
        currencyCode: "USD",
        detectedForDate: new Date("2026-04-14T00:00:00.000Z"),
        impactAmount: 27,
        severity: "CRITICAL",
        status: "NEW",
        title: "Gross margin dropped to 4.5%",
      },
    ],
    completeness: {
      level: DataCompletenessLevel.HIGH,
      orderCoverageRate: 1,
      snapshotDate: new Date("2026-04-14T00:00:00.000Z"),
      variantCoverageRate: 1,
    },
    currencyCode: "USD",
    generatedAt: new Date("2026-04-15T02:00:00.000Z"),
    health: {
      levelLabel: "Healthy",
      score: 87,
      scoreDate: new Date("2026-04-14T00:00:00.000Z"),
    },
    metrics: [
      {
        completenessLevel: DataCompletenessLevel.HIGH,
        discountAmount: 4,
        discountRate: 0.13793,
        grossMarginRate: 0.69241,
        grossProfitBeforeAdSpend: 20.08,
        grossSalesAmount: 29,
        metricDate: new Date("2026-04-14T00:00:00.000Z"),
        ordersCount: 1,
        productCostAmount: 8.75,
        refundAmount: 0,
        refundRate: 0,
        shippingCostEstimateAmount: 0,
        shippingRevenueAmount: 0,
        transactionFeeEstimateAmount: 0.17,
      },
    ],
    periodEnd: new Date("2026-04-14T00:00:00.000Z"),
    periodStart: new Date("2026-04-14T00:00:00.000Z"),
    reportType: ReportType.DAILY,
  });

  assert.equal(payload.reportType, "DAILY");
  assert.equal(payload.kpis.ordersCount, 1);
  assert.equal(payload.kpis.grossSalesAmount, "29.00");
  assert.equal(payload.health.score, 87);
  assert.equal(payload.generator.fallbackUsed, true);
  assert.equal(payload.generator.provider, "fallback_template");
  assert.equal(payload.generator.modelName, "rules-first-v1");
  assert.match(payload.narrative.summary, /Gross sales landed at 29.00 USD/);
  assert.equal(payload.topAlerts.length, 1);
});

test("getAiReportGenerationConfig defaults to disabled mode without AI credentials", () => {
  const previousProvider = process.env.PROFIT_GUARD_AI_PROVIDER;
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

  delete process.env.PROFIT_GUARD_AI_PROVIDER;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const config = getAiReportGenerationConfig();

  assert.equal(config.provider, "disabled");
  assert.equal(config.ready, false);

  if (previousProvider === undefined) {
    delete process.env.PROFIT_GUARD_AI_PROVIDER;
  } else {
    process.env.PROFIT_GUARD_AI_PROVIDER = previousProvider;
  }

  if (previousApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousApiKey;
  }

  if (previousOpenRouterApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = previousOpenRouterApiKey;
  }
});

test("getAiReportGenerationConfig supports OpenRouter credentials", () => {
  const previousProvider = process.env.PROFIT_GUARD_AI_PROVIDER;
  const previousApiKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.PROFIT_GUARD_OPENROUTER_MODEL;
  const previousBaseUrl = process.env.PROFIT_GUARD_OPENROUTER_BASE_URL;

  process.env.PROFIT_GUARD_AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "or-test-key";
  process.env.PROFIT_GUARD_OPENROUTER_MODEL = "openai/gpt-4.1-mini";
  process.env.PROFIT_GUARD_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

  const config = getAiReportGenerationConfig();

  assert.equal(config.provider, "openrouter");
  assert.equal(config.ready, true);
  assert.equal(config.apiKey, "or-test-key");
  assert.equal(config.modelName, "openai/gpt-4.1-mini");
  assert.equal(config.baseUrl, "https://openrouter.ai/api/v1");

  if (previousProvider === undefined) {
    delete process.env.PROFIT_GUARD_AI_PROVIDER;
  } else {
    process.env.PROFIT_GUARD_AI_PROVIDER = previousProvider;
  }

  if (previousApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = previousApiKey;
  }

  if (previousModel === undefined) {
    delete process.env.PROFIT_GUARD_OPENROUTER_MODEL;
  } else {
    process.env.PROFIT_GUARD_OPENROUTER_MODEL = previousModel;
  }

  if (previousBaseUrl === undefined) {
    delete process.env.PROFIT_GUARD_OPENROUTER_BASE_URL;
  } else {
    process.env.PROFIT_GUARD_OPENROUTER_BASE_URL = previousBaseUrl;
  }
});

test("renderReportExportContent produces json, markdown, csv, html, email text, and share image outputs", () => {
  const snapshot = {
    aiArtifactId: "artifact_1",
    createdAt: "2026-04-15T02:00:00.000Z",
    id: "report_1",
    payload: buildFallbackReportPayload({
      alerts: [],
      completeness: null,
      currencyCode: "USD",
      generatedAt: new Date("2026-04-15T02:00:00.000Z"),
      health: null,
      metrics: [
        {
          completenessLevel: DataCompletenessLevel.MEDIUM,
          discountAmount: 12,
          discountRate: 0.12,
          grossMarginRate: 0.32,
          grossProfitBeforeAdSpend: 64,
          grossSalesAmount: 200,
          metricDate: new Date("2026-04-14T00:00:00.000Z"),
          ordersCount: 5,
          productCostAmount: 80,
          refundAmount: 10,
          refundRate: 0.05,
          shippingCostEstimateAmount: 6,
          shippingRevenueAmount: 0,
          transactionFeeEstimateAmount: 4,
        },
      ],
      periodEnd: new Date("2026-04-14T00:00:00.000Z"),
      periodStart: new Date("2026-04-08T00:00:00.000Z"),
      reportType: ReportType.WEEKLY,
    }),
    periodEnd: "2026-04-14T00:00:00.000Z",
    periodStart: "2026-04-08T00:00:00.000Z",
    reportType: "WEEKLY" as const,
    updatedAt: "2026-04-15T02:00:00.000Z",
  };

  const jsonOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "json",
    snapshot,
  });
  const markdownOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "markdown",
    snapshot,
  });
  const csvOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "csv",
    snapshot,
  });
  const htmlOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "html",
    snapshot,
  });
  const emailTextOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "email_text",
    snapshot,
  });
  const shareImageOutput = renderReportExportContent({
    currencyCode: "USD",
    format: "share_image",
    snapshot,
  });

  assert.match(jsonOutput, /"snapshotId": "report_1"/);
  assert.match(markdownOutput, /# Weekly summary/);
  assert.match(csvOutput, /"metric","value"/);
  assert.match(csvOutput, /"orders_count","5"/);
  assert.match(htmlOutput, /<!DOCTYPE html>/);
  assert.match(htmlOutput, /<h1[^>]*>Weekly summary/);
  assert.match(emailTextOutput, /Subject: Profit Guard weekly summary/);
  assert.match(emailTextOutput, /Highlights:/);
  assert.match(shareImageOutput, /<svg/);
  assert.match(shareImageOutput, /Profit Guard/);
});

test("buildReportPdfContent produces a downloadable PDF payload", async () => {
  const snapshot = {
    aiArtifactId: "artifact_1",
    createdAt: "2026-04-15T02:00:00.000Z",
    id: "report_1",
    payload: buildFallbackReportPayload({
      alerts: [],
      completeness: null,
      currencyCode: "USD",
      generatedAt: new Date("2026-04-15T02:00:00.000Z"),
      health: null,
      metrics: [
        {
          completenessLevel: DataCompletenessLevel.HIGH,
          discountAmount: 4,
          discountRate: 0.08,
          grossMarginRate: 0.31,
          grossProfitBeforeAdSpend: 42,
          grossSalesAmount: 136,
          metricDate: new Date("2026-04-14T00:00:00.000Z"),
          ordersCount: 4,
          productCostAmount: 64,
          refundAmount: 6,
          refundRate: 0.04412,
          shippingCostEstimateAmount: 3,
          shippingRevenueAmount: 0,
          transactionFeeEstimateAmount: 2,
        },
      ],
      periodEnd: new Date("2026-04-14T00:00:00.000Z"),
      periodStart: new Date("2026-04-14T00:00:00.000Z"),
      reportType: ReportType.DAILY,
    }),
    periodEnd: "2026-04-14T00:00:00.000Z",
    periodStart: "2026-04-14T00:00:00.000Z",
    reportType: "DAILY" as const,
    updatedAt: "2026-04-15T02:00:00.000Z",
  };

  const pdfBytes = await buildReportPdfContent({
    currencyCode: "USD",
    snapshot,
  });

  assert.equal(Buffer.from(pdfBytes).subarray(0, 5).toString("utf8"), "%PDF-");
});

test("buildDigestDeliverySubject produces predictable daily and weekly subjects", () => {
  assert.equal(
    buildDigestDeliverySubject({
      periodLabel: "Apr 14, 2026",
      reportType: "DAILY",
    }),
    "Profit Guard daily summary for Apr 14, 2026",
  );
  assert.equal(
    buildDigestDeliverySubject({
      periodLabel: "Apr 8, 2026 - Apr 14, 2026",
      reportType: "WEEKLY",
    }),
    "Profit Guard weekly summary for Apr 8, 2026 - Apr 14, 2026",
  );
});
