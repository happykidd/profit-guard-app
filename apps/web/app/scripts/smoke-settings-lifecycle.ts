import assert from "node:assert/strict";
import db from "../db.server";
import { markShopUninstalled } from "../services/platform.server";
import { buildSettingsExportResponse } from "../services/settings.server";

async function main() {
  const shopDomain = `settings-lifecycle-${Date.now()}.myshopify.com`;
  const shop = await db.shop.create({
    data: {
      shopDomain,
      shopName: "Profit Guard Settings Lifecycle Smoke Shop",
      currencyCode: "USD",
      ianaTimezone: "UTC",
      currentPlan: "STARTER",
      subscriptionStatus: "ACTIVE",
      backfillStatus: "COMPLETED",
    },
  });

  try {
    await db.transactionFeeProfile.create({
      data: {
        shopId: shop.id,
        percentageRate: "0.0290",
        fixedFeeAmount: "0.3000",
        currencyCode: "USD",
        isDefault: true,
      },
    });

    await db.notificationPreference.create({
      data: {
        shopId: shop.id,
        dailySummaryEnabled: true,
        weeklySummaryEnabled: true,
        alertDigestEnabled: false,
        recipientEmails: ["owner@example.com", "ops@example.com"],
        replyToEmail: "support@example.com",
        preferredSendHour: 7,
        timezoneOverride: "Asia/Shanghai",
      },
    });

    await db.variantCost.create({
      data: {
        shopId: shop.id,
        sku: "PG-SETTINGS-001",
        sourceType: "MANUAL",
        costAmount: "9.9900",
        currencyCode: "USD",
        confidenceLevel: "HIGH",
        effectiveFrom: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    await db.supplierContractProfile.create({
      data: {
        shopId: shop.id,
        vendorName: "Acme",
        productType: "hoodie",
        unitCostAmount: "8.5000",
        currencyCode: "USD",
        effectiveFrom: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    await db.categoryCostProfile.create({
      data: {
        shopId: shop.id,
        categoryKey: "product_type:hoodie",
        defaultCostRate: "0.3300",
      },
    });

    const thread = await db.alertThread.create({
      data: {
        shopId: shop.id,
        alertType: "SHOP_LOW_MARGIN",
        entityType: "SHOP",
        entityKey: "shop",
        isOpen: true,
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    await db.alert.create({
      data: {
        shopId: shop.id,
        threadId: thread.id,
        alertType: "SHOP_LOW_MARGIN",
        severity: "HIGH",
        status: "NEW",
        entityType: "SHOP",
        entityKey: "shop",
        title: "Gross margin dropped",
        impactAmount: "18.00",
        currencyCode: "USD",
        confidenceLevel: "HIGH",
        completenessLevel: "HIGH",
        detectedForDate: new Date("2026-04-15T00:00:00.000Z"),
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        rankScore: "72.5000",
        rulePayload: {
          grossMarginRate: 0.11,
        },
      },
    });

    await db.alertSavedView.create({
      data: {
        shopId: shop.id,
        name: "Ops queue",
        visibility: "SHARED",
        createdByLabel: "David",
        description: "Lifecycle QA queue",
        queue: "ACTIVE",
        severity: "ALL",
        alertType: "ALL",
        entityType: "ALL",
      },
    });

    await db.billingSubscription.create({
      data: {
        shopId: shop.id,
        shopifyChargeId: `charge_${Date.now()}`,
        plan: "STARTER",
        status: "ACTIVE",
        priceAmount: "29.00",
        currencyCode: "USD",
        test: true,
      },
    });

    await db.billingEvent.create({
      data: {
        shopId: shop.id,
        eventType: "BILLING_SUBSCRIPTION_UPDATED",
        payload: {
          status: "ACTIVE",
        },
        processedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    await db.reportSnapshot.create({
      data: {
        shopId: shop.id,
        reportType: "DAILY",
        periodStart: new Date("2026-04-14T00:00:00.000Z"),
        periodEnd: new Date("2026-04-14T00:00:00.000Z"),
        payload: {
          summary: "Portable export smoke",
        },
      },
    });

    const reportSnapshot = await db.reportSnapshot.findFirstOrThrow({
      where: {
        reportType: "DAILY",
        shopId: shop.id,
      },
    });

    await db.digestDelivery.create({
      data: {
        attemptCount: 1,
        exportFormat: "email_text",
        lastAttemptAt: new Date("2026-04-15T01:00:00.000Z"),
        lastError: "SMTP timeout",
        recipientEmail: "owner@example.com",
        reportSnapshotId: reportSnapshot.id,
        reportType: "DAILY",
        shopId: shop.id,
        status: "FAILED",
        subject: "Profit Guard daily summary for Apr 14, 2026",
      },
    });

    await db.syncRun.createMany({
      data: [
        {
          shopId: shop.id,
          runType: "ORDER_BACKFILL",
          status: "QUEUED",
        },
        {
          shopId: shop.id,
          runType: "DAILY_REBUILD",
          status: "RUNNING",
          startedAt: new Date("2026-04-15T00:00:00.000Z"),
        },
      ],
    });

    await db.webhookEvent.create({
      data: {
        shopId: shop.id,
        topic: "shop/update",
        webhookId: `wh_${Date.now()}`,
        status: "PROCESSED",
        payload: {
          source: "smoke",
        },
        processedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    const exportResponse = await buildSettingsExportResponse({
      exportKind: "portability_bundle_json",
      shopDomain,
    });
    const exportBody = JSON.parse(await exportResponse.text()) as {
      packageType: string;
      shop: {
        currentPlan: string;
        isActive: boolean;
      };
      summary: {
        alerts: number;
        digestDeliveries: number;
        digestRecipients: number;
        subscriptions: number;
      };
      data: {
        alertThreads: Array<{ isOpen: boolean }>;
        digestDeliveries: Array<{ lastError: string | null; status: string }>;
        notificationPreference: {
          preferredSendHour: number;
          recipientEmails: string[];
        } | null;
        syncRuns: Array<{ status: string }>;
      };
    };

    assert.equal(exportBody.packageType, "PROFIT_GUARD_PORTABILITY_BUNDLE");
    assert.equal(exportBody.summary.alerts, 1);
    assert.equal(exportBody.summary.digestDeliveries, 1);
    assert.equal(exportBody.summary.digestRecipients, 2);
    assert.equal(exportBody.summary.subscriptions, 1);
    assert.equal(exportBody.shop.currentPlan, "STARTER");
    assert.equal(exportBody.data.notificationPreference?.preferredSendHour, 7);
    assert.equal(exportBody.data.notificationPreference?.recipientEmails.length, 2);
    assert.equal(exportBody.data.digestDeliveries[0]?.status, "FAILED");
    assert.equal(exportBody.data.digestDeliveries[0]?.lastError, "SMTP timeout");
    assert.equal(exportBody.data.syncRuns.length, 2);
    assert.equal(exportBody.data.alertThreads[0]?.isOpen, true);

    const cleanupSummary = await markShopUninstalled(shopDomain);
    assert.equal(cleanupSummary.cancelledSyncRuns, 2);
    assert.equal(cleanupSummary.cancelledAlerts, 1);
    assert.equal(cleanupSummary.closedThreads, 1);

    const [updatedShop, syncRuns, alerts, threads, billingSubscriptions, uninstallEvent] = await Promise.all([
      db.shop.findUniqueOrThrow({
        where: {
          id: shop.id,
        },
      }),
      db.syncRun.findMany({
        where: {
          shopId: shop.id,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
      db.alert.findMany({
        where: {
          shopId: shop.id,
        },
      }),
      db.alertThread.findMany({
        where: {
          shopId: shop.id,
        },
      }),
      db.billingSubscription.findMany({
        where: {
          shopId: shop.id,
        },
      }),
      db.billingEvent.findFirst({
        where: {
          eventType: "APP_UNINSTALLED",
          shopId: shop.id,
        },
      }),
    ]);

    assert.equal(updatedShop.isActive, false);
    assert.equal(updatedShop.currentPlan, "FREE");
    assert.equal(updatedShop.subscriptionStatus, "CANCELLED");
    assert.ok(updatedShop.uninstalledAt, "Shop should store uninstall timestamp.");
    assert.ok(syncRuns.every((syncRun) => syncRun.status === "CANCELLED"));
    assert.ok(alerts.every((alert) => alert.status === "IGNORED"));
    assert.ok(threads.every((entry) => entry.isOpen === false));
    assert.ok(billingSubscriptions.every((subscription) => subscription.status === "CANCELLED"));
    assert.ok(uninstallEvent, "An APP_UNINSTALLED billing event should be recorded.");

    console.info(
      JSON.stringify(
        {
          exportSummary: exportBody.summary,
          cleanupSummary,
          shopStatus: {
            currentPlan: updatedShop.currentPlan,
            isActive: updatedShop.isActive,
            subscriptionStatus: updatedShop.subscriptionStatus,
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
  console.error("[smoke] Settings lifecycle failed", error);
  await db.$disconnect();
  process.exit(1);
});
