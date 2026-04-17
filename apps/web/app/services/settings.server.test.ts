import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPortableDataPackagePayload,
  parseNotificationRecipientsInput,
  renderAlertsExportCsv,
  renderCostsExportCsv,
} from "./settings.server";

test("renderAlertsExportCsv includes alert headers and rows", () => {
  const csv = renderAlertsExportCsv([
    {
      alertType: "SHOP_LOW_MARGIN",
      completenessLevel: "LOW",
      currencyCode: "USD",
      detectedForDate: new Date("2026-04-15T00:00:00.000Z"),
      entityKey: "shop",
      entityType: "SHOP",
      impactAmount: "19.50",
      severity: "HIGH",
      status: "NEW",
      title: "Gross margin dropped",
    },
  ]);

  assert.match(csv, /alert_type/);
  assert.match(csv, /SHOP_LOW_MARGIN/);
  assert.match(csv, /Gross margin dropped/);
});

test("renderCostsExportCsv merges direct costs, supplier contracts, and fallback rules", () => {
  const csv = renderCostsExportCsv({
    categoryProfiles: [
      {
        categoryKey: "product_type:tshirt",
        defaultCostRate: "0.3200",
        importedBatchKey: "batch-3",
        notes: "Fallback",
      },
    ],
    supplierContracts: [
      {
        currencyCode: "USD",
        effectiveFrom: new Date("2026-04-15T00:00:00.000Z"),
        effectiveTo: null,
        importedBatchKey: "batch-2",
        notes: "Vendor contract",
        productType: "tshirt",
        unitCostAmount: "8.5000",
        vendorName: "Acme",
      },
    ],
    variantCosts: [
      {
        costAmount: "9.9900",
        currencyCode: "USD",
        effectiveFrom: new Date("2026-04-15T00:00:00.000Z"),
        effectiveTo: null,
        importedBatchKey: "batch-1",
        notes: "Manual direct cost",
        sku: "PG-TEE-001",
        sourceType: "MANUAL",
        variantId: "variant-1",
      },
    ],
  });

  assert.match(csv, /DIRECT_COST/);
  assert.match(csv, /SUPPLIER_CONTRACT/);
  assert.match(csv, /FALLBACK_RULE/);
  assert.match(csv, /PG-TEE-001/);
  assert.match(csv, /Acme/);
});

test("buildPortableDataPackagePayload produces uninstall-friendly bundle", () => {
  const payload = buildPortableDataPackagePayload({
    alerts: [
      {
        alertType: "SHOP_LOW_MARGIN",
        completenessLevel: "HIGH",
        confidenceLevel: "HIGH",
        createdAt: new Date("2026-04-15T00:00:00.000Z"),
        currencyCode: "USD",
        detectedForDate: new Date("2026-04-15T00:00:00.000Z"),
        entityKey: "shop",
        entityType: "SHOP",
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        id: "alert_1",
        impactAmount: "42.00",
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        rankScore: "88.4000",
        severity: "HIGH",
        status: "NEW",
        threadId: "thread_1",
        title: "Gross margin dropped",
        updatedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    ],
    alertFeedbacks: [],
    alertStatusHistory: [],
    alertThreads: [],
    billingEvents: [],
    categoryProfiles: [],
    notificationPreference: null,
    reportExports: [],
    reports: [],
    digestDeliveries: [],
    savedViews: [],
    shop: {
      backfillStatus: "COMPLETED",
      countryCode: "US",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      currencyCode: "USD",
      currentPlan: "FREE",
      email: "owner@example.com",
      ianaTimezone: "UTC",
      id: "shop_1",
      installedAt: new Date("2026-04-01T00:00:00.000Z"),
      isActive: false,
      lastSyncedAt: new Date("2026-04-15T00:00:00.000Z"),
      planName: "Starter",
      primaryDomain: "example.com",
      shopDomain: "portable.myshopify.com",
      shopName: "Portable Shop",
      subscriptionStatus: "CANCELLED",
      uninstalledAt: new Date("2026-04-15T01:00:00.000Z"),
      updatedAt: new Date("2026-04-15T01:00:00.000Z"),
    },
    subscriptions: [],
    supplierContracts: [],
    syncRuns: [],
    transactionFeeProfiles: [],
    variantCosts: [],
    webhookEvents: [],
  });

  assert.equal(payload.packageType, "PROFIT_GUARD_PORTABILITY_BUNDLE");
  assert.equal(payload.summary.alerts, 1);
  assert.equal(payload.shop.shopDomain, "portable.myshopify.com");
  assert.equal(payload.shop.uninstalledAt, "2026-04-15T01:00:00.000Z");
  assert.equal(payload.data.alerts[0]?.impactAmount, "42.00");
});

test("parseNotificationRecipientsInput normalizes comma and newline separated addresses", () => {
  const recipients = parseNotificationRecipientsInput(
    "Owner@example.com,\nops@example.com, owner@example.com",
  );

  assert.deepEqual(recipients, ["owner@example.com", "ops@example.com"]);
});
