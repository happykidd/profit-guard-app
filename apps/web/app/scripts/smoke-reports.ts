import assert from "node:assert/strict";
import { ReportType } from "@prisma/client";
import db from "../db.server";
import {
  buildReportExportResponse,
  generateReportSnapshot,
  getReportsOverview,
  prepareDigestDeliveries,
  transitionDigestDelivery,
} from "../services/reports.server";

function withOfflineAiEnv<T>(callback: () => Promise<T>) {
  const originalEnv = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    PROFIT_GUARD_AI_PROVIDER: process.env.PROFIT_GUARD_AI_PROVIDER,
  };

  process.env.PROFIT_GUARD_AI_PROVIDER = "disabled";
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  return callback().finally(() => {
    if (originalEnv.PROFIT_GUARD_AI_PROVIDER == null) {
      delete process.env.PROFIT_GUARD_AI_PROVIDER;
    } else {
      process.env.PROFIT_GUARD_AI_PROVIDER = originalEnv.PROFIT_GUARD_AI_PROVIDER;
    }

    if (originalEnv.OPENAI_API_KEY == null) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    }

    if (originalEnv.OPENROUTER_API_KEY == null) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
    }
  });
}

async function main() {
  const shopDomain = `reports-smoke-${Date.now()}.myshopify.com`;
  const shop = await db.shop.create({
    data: {
      shopDomain,
      shopName: "Profit Guard Reports Smoke Shop",
      currencyCode: "USD",
      ianaTimezone: "UTC",
      backfillStatus: "COMPLETED",
    },
  });

  try {
    const metricDates = [
      "2026-04-08T00:00:00.000Z",
      "2026-04-09T00:00:00.000Z",
      "2026-04-10T00:00:00.000Z",
      "2026-04-11T00:00:00.000Z",
      "2026-04-12T00:00:00.000Z",
      "2026-04-13T00:00:00.000Z",
      "2026-04-14T00:00:00.000Z",
    ];

    await db.dailyShopMetric.createMany({
      data: metricDates.map((metricDate, index) => ({
        shopId: shop.id,
        metricDate: new Date(metricDate),
        ordersCount: index + 1,
        grossSalesAmount: 40 + index * 10,
        discountAmount: 4 + index,
        refundAmount: index === 6 ? 8 : 2,
        shippingRevenueAmount: 0,
        shippingCostEstimateAmount: 0,
        transactionFeeEstimateAmount: 1 + index * 0.2,
        productCostAmount: 12 + index * 2,
        grossProfitBeforeAdSpend: 18 + index * 4,
        grossMarginRate: 0.45 - index * 0.02,
        averageOrderShippingCost: 0,
        refundRate: index === 6 ? 0.1 : 0.03,
        discountRate: 0.1 + index * 0.01,
        completenessLevel: index >= 5 ? "HIGH" : "MEDIUM",
      })),
    });

    await db.profitHealthScore.create({
      data: {
        shopId: shop.id,
        scoreDate: new Date("2026-04-14T00:00:00.000Z"),
        score: 82,
        levelLabel: "Healthy",
        deductionsPayload: {
          deductions: [],
        },
      },
    });

    await db.dataCompletenessSnapshot.create({
      data: {
        shopId: shop.id,
        snapshotDate: new Date("2026-04-14T00:00:00.000Z"),
        level: "HIGH",
        variantCoverageRate: 0.95,
        orderCoverageRate: 0.9,
        payload: {
          source: "smoke",
        },
      },
    });

    await db.alertThread.create({
      data: {
        shopId: shop.id,
        alertType: "SHOP_LOW_MARGIN",
        entityType: "SHOP",
        entityKey: "shop",
        isOpen: true,
        firstDetectedAt: new Date("2026-04-14T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-14T00:00:00.000Z"),
        alerts: {
          create: [
            {
              shopId: shop.id,
              alertType: "SHOP_LOW_MARGIN",
              severity: "HIGH",
              status: "NEW",
              entityType: "SHOP",
              entityKey: "shop",
              title: "Gross margin compressed to 33.0%",
              impactAmount: 18,
              currencyCode: "USD",
              confidenceLevel: "HIGH",
              completenessLevel: "HIGH",
              detectedForDate: new Date("2026-04-14T00:00:00.000Z"),
              firstDetectedAt: new Date("2026-04-14T00:00:00.000Z"),
              lastDetectedAt: new Date("2026-04-14T00:00:00.000Z"),
              rankScore: 76,
              rulePayload: {
                grossMarginRate: 0.33,
              },
            },
          ],
        },
      },
    });

    await db.notificationPreference.create({
      data: {
        alertDigestEnabled: true,
        dailySummaryEnabled: true,
        preferredSendHour: 8,
        recipientEmails: ["owner@example.com", "ops@example.com"],
        replyToEmail: "support@example.com",
        shopId: shop.id,
        timezoneOverride: "UTC",
        weeklySummaryEnabled: true,
      },
    });

    const {
      daily,
      weekly,
      exportBody,
      htmlExportBody,
      emailTextExportBody,
      pdfExportBytes,
      shareImageExportBody,
      preparedDigests,
      failedDigest,
      retriedDigest,
      deliveredDigest,
      overview,
      exportResponse,
      htmlExportResponse,
      emailTextExportResponse,
      pdfExportResponse,
      shareImageExportResponse,
    } = await withOfflineAiEnv(async () => {
      // Force the entire reports smoke flow to stay deterministic even when
      // local OpenAI/OpenRouter credentials are configured for real environments.
      const dailySnapshot = await generateReportSnapshot({
        reportType: ReportType.DAILY,
        shopDomain,
      });
      const weeklySnapshot = await generateReportSnapshot({
        reportType: ReportType.WEEKLY,
        shopDomain,
      });
      const markdownExportResponse = await buildReportExportResponse({
        exportFormat: "markdown",
        reportType: ReportType.WEEKLY,
        shopDomain,
      });
      const markdownExportBody = await markdownExportResponse.text();
      const htmlResponse = await buildReportExportResponse({
        exportFormat: "html",
        reportType: ReportType.DAILY,
        shopDomain,
      });
      const htmlBody = await htmlResponse.text();
      const emailTextResponse = await buildReportExportResponse({
        exportFormat: "email_text",
        reportType: ReportType.WEEKLY,
        shopDomain,
      });
      const emailTextBody = await emailTextResponse.text();
      const pdfResponse = await buildReportExportResponse({
        exportFormat: "pdf",
        reportType: ReportType.DAILY,
        shopDomain,
      });
      const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
      const shareImageResponse = await buildReportExportResponse({
        exportFormat: "share_image",
        reportType: ReportType.DAILY,
        shopDomain,
      });
      const shareImageBody = await shareImageResponse.text();
      const digestBatch = await prepareDigestDeliveries({
        reportType: ReportType.WEEKLY,
        shopDomain,
      });
      const failed = await transitionDigestDelivery({
        deliveryId: digestBatch.deliveries[0]!.id,
        errorMessage: "SMTP timeout",
        shopDomain,
        status: "FAILED",
      });
      const retried = await transitionDigestDelivery({
        deliveryId: failed.id,
        shopDomain,
        status: "PREPARED",
      });
      const delivered = await transitionDigestDelivery({
        deliveryId: retried.id,
        shopDomain,
        status: "SENT",
      });
      const reportsOverview = await getReportsOverview(shopDomain);

      return {
        daily: dailySnapshot,
        weekly: weeklySnapshot,
        exportBody: markdownExportBody,
        htmlExportBody: htmlBody,
        emailTextExportBody: emailTextBody,
        pdfExportBytes: pdfBytes,
        shareImageExportBody: shareImageBody,
        preparedDigests: digestBatch,
        failedDigest: failed,
        retriedDigest: retried,
        deliveredDigest: delivered,
        overview: reportsOverview,
        exportResponse: markdownExportResponse,
        htmlExportResponse: htmlResponse,
        emailTextExportResponse: emailTextResponse,
        pdfExportResponse: pdfResponse,
        shareImageExportResponse: shareImageResponse,
      };
    });

    assert.equal(daily.snapshot.reportType, "DAILY");
    assert.equal(weekly.snapshot.reportType, "WEEKLY");
    assert.equal(daily.snapshot.payload.generator.fallbackUsed, true);
    assert.equal(weekly.snapshot.payload.generator.fallbackUsed, true);
    assert.ok(overview, "Reports overview should load.");
    assert.ok(overview?.dailyReport, "Daily report should exist.");
    assert.ok(overview?.weeklyReport, "Weekly report should exist.");
    assert.equal(overview?.recentExports.length, 5);
    assert.equal(preparedDigests.preparedCount, 2);
    assert.match(exportBody, /## KPIs/);
    assert.match(htmlExportBody, /<!DOCTYPE html>/);
    assert.match(emailTextExportBody, /Subject: Profit Guard weekly summary/);
    assert.equal(pdfExportBytes.subarray(0, 5).toString("utf8"), "%PDF-");
    assert.match(shareImageExportBody, /<svg/);
    assert.equal(failedDigest.status, "FAILED");
    assert.equal(failedDigest.attemptCount, 1);
    assert.equal(retriedDigest.status, "PREPARED");
    assert.equal(retriedDigest.lastError, null);
    assert.equal(deliveredDigest.status, "SENT");
    assert.equal(deliveredDigest.attemptCount, 2);
    assert.ok(deliveredDigest.deliveredAt);
    assert.equal(overview?.recentDigestDeliveries.length, 2);
    assert.equal(overview?.recentDigestDeliveries.some((delivery) => delivery.status === "SENT"), true);

    console.info(
      JSON.stringify(
        {
          dailyReport: {
            headline: daily.snapshot.payload.narrative.headline,
            period: daily.snapshot.payload.period.label,
          },
          weeklyReport: {
            headline: weekly.snapshot.payload.narrative.headline,
            period: weekly.snapshot.payload.period.label,
          },
          export: {
            contentDisposition: exportResponse.headers.get("Content-Disposition"),
            contentType: exportResponse.headers.get("Content-Type"),
            digestDeliveryCount: overview?.recentDigestDeliveries.length ?? 0,
            exportLogCount: overview?.recentExports.length ?? 0,
            htmlContentType: htmlExportResponse.headers.get("Content-Type"),
            emailTextContentType: emailTextExportResponse.headers.get("Content-Type"),
            pdfContentType: pdfExportResponse.headers.get("Content-Type"),
            shareImageContentType: shareImageExportResponse.headers.get("Content-Type"),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await db.shop.delete({
      where: {
        id: shop.id,
      },
    });

    await db.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Reports generation failed", error);
  await db.$disconnect();
  process.exit(1);
});
