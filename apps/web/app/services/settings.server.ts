import db from "../db.server";

const SETTINGS_EXPORT_KINDS = [
  "alerts_csv",
  "costs_csv",
  "summaries_json",
  "portability_bundle_json",
] as const;

type SettingsExportKind = (typeof SETTINGS_EXPORT_KINDS)[number];

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeCsvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toStringOrNull(value: { toString(): string } | null | undefined) {
  return value == null ? null : value.toString();
}

export function buildPortableDataPackagePayload(args: {
  alerts: Array<{
    alertType: string;
    completenessLevel: string;
    confidenceLevel: string;
    createdAt: Date;
    currencyCode: string | null;
    detectedForDate: Date;
    entityKey: string;
    entityType: string;
    firstDetectedAt: Date;
    id: string;
    impactAmount: string | null;
    lastDetectedAt: Date;
    rankScore: string | null;
    severity: string;
    status: string;
    threadId: string | null;
    title: string;
    updatedAt: Date;
  }>;
  alertFeedbacks: Array<{
    actorId: string | null;
    actorType: string | null;
    alertId: string;
    createdAt: Date;
    feedback: string;
    id: string;
    note: string | null;
  }>;
  alertStatusHistory: Array<{
    actorId: string | null;
    actorType: string | null;
    alertId: string;
    createdAt: Date;
    fromStatus: string | null;
    id: string;
    note: string | null;
    toStatus: string;
  }>;
  alertThreads: Array<{
    alertType: string;
    createdAt: Date;
    entityKey: string;
    entityType: string;
    firstDetectedAt: Date;
    id: string;
    isOpen: boolean;
    lastDetectedAt: Date;
    ownerAssignedAt: Date | null;
    ownerName: string | null;
    reviewedAt: Date | null;
    reviewerName: string | null;
    updatedAt: Date;
    workflowNote: string | null;
  }>;
  billingEvents: Array<{
    createdAt: Date;
    eventType: string;
    id: string;
    processedAt: Date | null;
    shopifyChargeId: string | null;
  }>;
  categoryProfiles: Array<{
    categoryKey: string;
    createdAt: Date;
    defaultCostRate: string;
    id: string;
    importedBatchKey: string | null;
    notes: string | null;
    updatedAt: Date;
  }>;
  notificationPreference: {
    alertDigestEnabled: boolean;
    createdAt: Date;
    dailySummaryEnabled: boolean;
    preferredSendHour: number;
    recipientEmails: string[];
    replyToEmail: string | null;
    timezoneOverride: string | null;
    updatedAt: Date;
    weeklySummaryEnabled: boolean;
  } | null;
  reportExports: Array<{
    createdAt: Date;
    exportFormat: string;
    id: string;
    reportType: string;
    status: string;
    storageKey: string | null;
    updatedAt: Date;
  }>;
  reports: Array<{
    createdAt: Date;
    id: string;
    payload: unknown;
    periodEnd: Date;
    periodStart: Date;
    reportType: string;
    updatedAt: Date;
  }>;
  digestDeliveries: Array<{
    attemptCount: number;
    createdAt: Date;
    deliveredAt: Date | null;
    exportFormat: string;
    id: string;
    lastAttemptAt: Date | null;
    lastError: string | null;
    recipientEmail: string;
    reportSnapshotId: string | null;
    reportType: string;
    status: string;
    subject: string;
    updatedAt: Date;
  }>;
  savedViews: Array<{
    alertType: string;
    createdAt: Date;
    createdByLabel: string | null;
    description: string | null;
    entityType: string;
    id: string;
    name: string;
    queue: string;
    search: string | null;
    severity: string;
    updatedAt: Date;
    visibility: string;
  }>;
  shop: {
    backfillStatus: string;
    countryCode: string | null;
    createdAt: Date;
    currencyCode: string | null;
    currentPlan: string;
    email: string | null;
    ianaTimezone: string | null;
    id: string;
    installedAt: Date;
    isActive: boolean;
    lastSyncedAt: Date | null;
    planName: string | null;
    primaryDomain: string | null;
    shopDomain: string;
    shopName: string | null;
    subscriptionStatus: string;
    uninstalledAt: Date | null;
    updatedAt: Date;
  };
  subscriptions: Array<{
    cancelledAt: Date | null;
    createdAt: Date;
    currentPeriodEnd: Date | null;
    currentPeriodStart: Date | null;
    currencyCode: string | null;
    id: string;
    interval: string | null;
    plan: string;
    priceAmount: string | null;
    shopifyChargeId: string;
    status: string;
    test: boolean;
    trialDays: number | null;
    updatedAt: Date;
  }>;
  supplierContracts: Array<{
    createdAt: Date;
    currencyCode: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    id: string;
    importedBatchKey: string | null;
    notes: string | null;
    productType: string | null;
    unitCostAmount: string;
    updatedAt: Date;
    vendorName: string;
  }>;
  syncRuns: Array<{
    createdAt: Date;
    errorMessage: string | null;
    finishedAt: Date | null;
    id: string;
    recordsSynced: number;
    recordsTotal: number | null;
    runType: string;
    startedAt: Date | null;
    status: string;
  }>;
  transactionFeeProfiles: Array<{
    createdAt: Date;
    currencyCode: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    fixedFeeAmount: string;
    id: string;
    isDefault: boolean;
    percentageRate: string;
  }>;
  variantCosts: Array<{
    costAmount: string;
    currencyCode: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    id: string;
    importedBatchKey: string | null;
    notes: string | null;
    sku: string | null;
    sourceType: string;
    variantId: string | null;
  }>;
  webhookEvents: Array<{
    apiVersion: string | null;
    errorMessage: string | null;
    id: string;
    processedAt: Date | null;
    receivedAt: Date;
    status: string;
    topic: string;
    webhookId: string;
  }>;
}) {
  return {
    exportedAt: new Date().toISOString(),
    packageType: "PROFIT_GUARD_PORTABILITY_BUNDLE",
    version: 1 as const,
    shop: {
      ...args.shop,
      createdAt: args.shop.createdAt.toISOString(),
      installedAt: args.shop.installedAt.toISOString(),
      lastSyncedAt: toIsoString(args.shop.lastSyncedAt),
      uninstalledAt: toIsoString(args.shop.uninstalledAt),
      updatedAt: args.shop.updatedAt.toISOString(),
    },
    summary: {
      alerts: args.alerts.length,
      digestDeliveries: args.digestDeliveries.length,
      digestRecipients: args.notificationPreference?.recipientEmails.length ?? 0,
      reports: args.reports.length,
      savedViews: args.savedViews.length,
      subscriptions: args.subscriptions.length,
      syncRuns: args.syncRuns.length,
      transactionFeeProfiles: args.transactionFeeProfiles.length,
      webhookEvents: args.webhookEvents.length,
    },
    data: {
      alerts: args.alerts.map((alert) => ({
        ...alert,
        createdAt: alert.createdAt.toISOString(),
        detectedForDate: alert.detectedForDate.toISOString(),
        firstDetectedAt: alert.firstDetectedAt.toISOString(),
        lastDetectedAt: alert.lastDetectedAt.toISOString(),
        updatedAt: alert.updatedAt.toISOString(),
      })),
      alertFeedbacks: args.alertFeedbacks.map((feedback) => ({
        ...feedback,
        createdAt: feedback.createdAt.toISOString(),
      })),
      alertStatusHistory: args.alertStatusHistory.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
      alertThreads: args.alertThreads.map((thread) => ({
        ...thread,
        createdAt: thread.createdAt.toISOString(),
        firstDetectedAt: thread.firstDetectedAt.toISOString(),
        lastDetectedAt: thread.lastDetectedAt.toISOString(),
        ownerAssignedAt: toIsoString(thread.ownerAssignedAt),
        reviewedAt: toIsoString(thread.reviewedAt),
        updatedAt: thread.updatedAt.toISOString(),
      })),
      billingEvents: args.billingEvents.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
        processedAt: toIsoString(event.processedAt),
      })),
      categoryProfiles: args.categoryProfiles.map((profile) => ({
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      })),
      notificationPreference: args.notificationPreference
        ? {
            ...args.notificationPreference,
            createdAt: args.notificationPreference.createdAt.toISOString(),
            updatedAt: args.notificationPreference.updatedAt.toISOString(),
          }
        : null,
      reportExports: args.reportExports.map((reportExport) => ({
        ...reportExport,
        createdAt: reportExport.createdAt.toISOString(),
        updatedAt: reportExport.updatedAt.toISOString(),
      })),
      digestDeliveries: args.digestDeliveries.map((delivery) => ({
        ...delivery,
        createdAt: delivery.createdAt.toISOString(),
        deliveredAt: toIsoString(delivery.deliveredAt),
        lastAttemptAt: toIsoString(delivery.lastAttemptAt),
        updatedAt: delivery.updatedAt.toISOString(),
      })),
      reports: args.reports.map((report) => ({
        ...report,
        createdAt: report.createdAt.toISOString(),
        periodEnd: report.periodEnd.toISOString(),
        periodStart: report.periodStart.toISOString(),
        updatedAt: report.updatedAt.toISOString(),
      })),
      savedViews: args.savedViews.map((savedView) => ({
        ...savedView,
        createdAt: savedView.createdAt.toISOString(),
        updatedAt: savedView.updatedAt.toISOString(),
      })),
      subscriptions: args.subscriptions.map((subscription) => ({
        ...subscription,
        cancelledAt: toIsoString(subscription.cancelledAt),
        createdAt: subscription.createdAt.toISOString(),
        currentPeriodEnd: toIsoString(subscription.currentPeriodEnd),
        currentPeriodStart: toIsoString(subscription.currentPeriodStart),
        updatedAt: subscription.updatedAt.toISOString(),
      })),
      supplierContracts: args.supplierContracts.map((contract) => ({
        ...contract,
        createdAt: contract.createdAt.toISOString(),
        effectiveFrom: contract.effectiveFrom.toISOString(),
        effectiveTo: toIsoString(contract.effectiveTo),
        updatedAt: contract.updatedAt.toISOString(),
      })),
      syncRuns: args.syncRuns.map((syncRun) => ({
        ...syncRun,
        createdAt: syncRun.createdAt.toISOString(),
        finishedAt: toIsoString(syncRun.finishedAt),
        startedAt: toIsoString(syncRun.startedAt),
      })),
      transactionFeeProfiles: args.transactionFeeProfiles.map((profile) => ({
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        effectiveFrom: profile.effectiveFrom.toISOString(),
        effectiveTo: toIsoString(profile.effectiveTo),
      })),
      variantCosts: args.variantCosts.map((cost) => ({
        ...cost,
        effectiveFrom: cost.effectiveFrom.toISOString(),
        effectiveTo: toIsoString(cost.effectiveTo),
      })),
      webhookEvents: args.webhookEvents.map((event) => ({
        ...event,
        processedAt: toIsoString(event.processedAt),
        receivedAt: event.receivedAt.toISOString(),
      })),
    },
  };
}

function normalizeExportKind(value: string | null | undefined): SettingsExportKind | null {
  const normalizedValue = (value ?? "").trim().toLowerCase();
  return SETTINGS_EXPORT_KINDS.includes(normalizedValue as SettingsExportKind)
    ? (normalizedValue as SettingsExportKind)
    : null;
}

export function parseNotificationRecipientsInput(value: string | null | undefined) {
  const recipients = (value ?? "")
    .split(/[,\n]/)
    .map((recipient) => recipient.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(recipients));
}

export function renderAlertsExportCsv(
  alerts: Array<{
    alertType: string;
    completenessLevel: string;
    currencyCode: string | null;
    detectedForDate: Date;
    entityKey: string;
    entityType: string;
    impactAmount: string | null;
    severity: string;
    status: string;
    title: string;
  }>,
) {
  const rows = [
    [
      "detected_for_date",
      "alert_type",
      "severity",
      "status",
      "entity_type",
      "entity_key",
      "title",
      "impact_amount",
      "currency_code",
      "completeness_level",
    ],
    ...alerts.map((alert) => [
      alert.detectedForDate.toISOString(),
      alert.alertType,
      alert.severity,
      alert.status,
      alert.entityType,
      alert.entityKey,
      alert.title,
      alert.impactAmount ?? "",
      alert.currencyCode ?? "",
      alert.completenessLevel,
    ]),
  ];

  return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
}

export function renderCostsExportCsv(args: {
  categoryProfiles: Array<{
    categoryKey: string;
    defaultCostRate: string;
    importedBatchKey: string | null;
    notes: string | null;
  }>;
  supplierContracts: Array<{
    currencyCode: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    importedBatchKey: string | null;
    notes: string | null;
    productType: string | null;
    unitCostAmount: string;
    vendorName: string;
  }>;
  variantCosts: Array<{
    costAmount: string;
    currencyCode: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    importedBatchKey: string | null;
    notes: string | null;
    sku: string | null;
    sourceType: string;
    variantId: string | null;
  }>;
}) {
  const rows = [
    [
      "record_type",
      "variant_id",
      "sku",
      "vendor_name",
      "product_type",
      "category_key",
      "source_type",
      "cost_or_rate",
      "currency_code",
      "effective_from",
      "effective_to",
      "imported_batch_key",
      "notes",
    ],
    ...args.variantCosts.map((cost) => [
      "DIRECT_COST",
      cost.variantId ?? "",
      cost.sku ?? "",
      "",
      "",
      "",
      cost.sourceType,
      cost.costAmount,
      cost.currencyCode,
      cost.effectiveFrom.toISOString(),
      cost.effectiveTo?.toISOString() ?? "",
      cost.importedBatchKey ?? "",
      cost.notes ?? "",
    ]),
    ...args.supplierContracts.map((contract) => [
      "SUPPLIER_CONTRACT",
      "",
      "",
      contract.vendorName,
      contract.productType ?? "",
      "",
      "SUPPLIER_CONTRACT",
      contract.unitCostAmount,
      contract.currencyCode,
      contract.effectiveFrom.toISOString(),
      contract.effectiveTo?.toISOString() ?? "",
      contract.importedBatchKey ?? "",
      contract.notes ?? "",
    ]),
    ...args.categoryProfiles.map((profile) => [
      "FALLBACK_RULE",
      "",
      "",
      "",
      "",
      profile.categoryKey,
      "CATEGORY_DEFAULT",
      profile.defaultCostRate,
      "",
      "",
      "",
      profile.importedBatchKey ?? "",
      profile.notes ?? "",
    ]),
  ];

  return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
}

export async function getSettingsOverview(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      backfillStatus: true,
      createdAt: true,
      countryCode: true,
      currencyCode: true,
      currentPlan: true,
      email: true,
      ianaTimezone: true,
      id: true,
      installedAt: true,
      isActive: true,
      lastSyncedAt: true,
      planName: true,
      primaryDomain: true,
      shopDomain: true,
      shopName: true,
      subscriptionStatus: true,
      uninstalledAt: true,
      updatedAt: true,
    },
  });

  if (!shop) {
    return null;
  }

  const [
    defaultTransactionFeeProfile,
    notificationPreference,
    reportCount,
    alertCount,
    recentWebhookEvents,
    activeSyncRunCount,
    openAlertThreadCount,
  ] = await Promise.all([
    db.transactionFeeProfile.findFirst({
      where: {
        shopId: shop.id,
        isDefault: true,
        effectiveTo: null,
      },
      orderBy: {
        effectiveFrom: "desc",
      },
    }),
    db.notificationPreference.findUnique({
      where: {
        shopId: shop.id,
      },
    }),
    db.reportSnapshot.count({
      where: {
        shopId: shop.id,
      },
    }),
    db.alert.count({
      where: {
        shopId: shop.id,
      },
    }),
    db.webhookEvent.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        receivedAt: "desc",
      },
      take: 8,
      select: {
        id: true,
        processedAt: true,
        receivedAt: true,
        status: true,
        topic: true,
      },
    }),
    db.syncRun.count({
      where: {
        shopId: shop.id,
        status: {
          in: ["QUEUED", "RUNNING"],
        },
      },
    }),
    db.alertThread.count({
      where: {
        isOpen: true,
        shopId: shop.id,
      },
    }),
  ]);

  return {
    exportCapabilities: [
      {
        description: "Historical alert list with severity, impact, and status.",
        exportKind: "alerts_csv" as const,
        label: "Historical alerts CSV",
      },
      {
        description: "Active direct costs, supplier contracts, and fallback rules.",
        exportKind: "costs_csv" as const,
        label: "Cost tables CSV",
      },
      {
        description: "Stored daily and weekly summaries with fallback AI payloads.",
        exportKind: "summaries_json" as const,
        label: "Reports archive JSON",
      },
      {
        description: "Portable JSON bundle for alerts, costs, reports, settings, sync runs, and webhook history.",
        exportKind: "portability_bundle_json" as const,
        label: "Portable data package JSON",
      },
    ],
    recentWebhookEvents: recentWebhookEvents.map((event) => ({
      id: event.id,
      processedAt: event.processedAt?.toISOString() ?? null,
      receivedAt: event.receivedAt.toISOString(),
      status: event.status,
      topic: event.topic,
    })),
    shop: {
      backfillStatus: shop.backfillStatus,
      currencyCode: shop.currencyCode ?? "USD",
      currentPlan: shop.currentPlan,
      email: shop.email,
      ianaTimezone: shop.ianaTimezone,
      installedAt: shop.installedAt.toISOString(),
      isActive: shop.isActive,
      lastSyncedAt: shop.lastSyncedAt?.toISOString() ?? null,
      shopDomain: shop.shopDomain,
      shopName: shop.shopName ?? shop.shopDomain,
      subscriptionStatus: shop.subscriptionStatus,
    },
    summary: {
      alertCount,
      openAlertThreadCount,
      reportCount,
      supportEmail: process.env.PROFIT_GUARD_SUPPORT_EMAIL || "support@example.com",
      activeSyncRunCount,
    },
    notificationPreference: notificationPreference
      ? {
          alertDigestEnabled: notificationPreference.alertDigestEnabled,
          dailySummaryEnabled: notificationPreference.dailySummaryEnabled,
          preferredSendHour: notificationPreference.preferredSendHour,
          recipientEmails: Array.isArray(notificationPreference.recipientEmails)
            ? notificationPreference.recipientEmails.filter((value): value is string => typeof value === "string")
            : [],
          replyToEmail: notificationPreference.replyToEmail,
          timezoneOverride: notificationPreference.timezoneOverride,
          weeklySummaryEnabled: notificationPreference.weeklySummaryEnabled,
        }
      : null,
    transactionFeeProfile: defaultTransactionFeeProfile
      ? {
          currencyCode: defaultTransactionFeeProfile.currencyCode,
          effectiveFrom: defaultTransactionFeeProfile.effectiveFrom.toISOString(),
          fixedFeeAmount: defaultTransactionFeeProfile.fixedFeeAmount.toString(),
          id: defaultTransactionFeeProfile.id,
          percentageRate: defaultTransactionFeeProfile.percentageRate.toString(),
        }
      : null,
    uninstallPolicy: {
      activeSyncRunCount,
      cleanupActions: [
        "Mark the shop inactive and stamp uninstall time.",
        "Cancel queued or running sync jobs so workers stop new pulls.",
        "Close open alert threads and move active alerts out of the queue.",
        "Keep the portability bundle available for support-led export workflows.",
      ],
      currentState: shop.isActive ? "ACTIVE" : "UNINSTALLED",
      openAlertThreadCount,
      uninstalledAt: shop.uninstalledAt?.toISOString() ?? null,
    },
  };
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
    },
  });
}

export async function upsertDefaultTransactionFeeProfile(args: {
  currencyCode?: string | null;
  fixedFeeAmount: string | number;
  percentageRate: string | number;
  shopDomain: string;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const percentageRate = toNumber(args.percentageRate);
  const fixedFeeAmount = toNumber(args.fixedFeeAmount);
  const currencyCode = (args.currencyCode || shop.currencyCode || "USD").trim().toUpperCase();

  if (percentageRate == null || percentageRate < 0 || percentageRate > 1) {
    throw new Error("Enter a percentage rate between 0 and 1.");
  }

  if (fixedFeeAmount == null || fixedFeeAmount < 0) {
    throw new Error("Enter a fixed fee amount that is zero or greater.");
  }

  const now = new Date();

  return db.$transaction(async (tx) => {
    await tx.transactionFeeProfile.updateMany({
      where: {
        shopId: shop.id,
        isDefault: true,
        effectiveTo: null,
      },
      data: {
        effectiveTo: now,
        isDefault: false,
      },
    });

    return tx.transactionFeeProfile.create({
      data: {
        currencyCode,
        effectiveFrom: now,
        fixedFeeAmount: fixedFeeAmount.toFixed(4),
        isDefault: true,
        percentageRate: percentageRate.toFixed(4),
        shopId: shop.id,
      },
    });
  });
}

export async function upsertNotificationPreference(args: {
  alertDigestEnabled: boolean;
  dailySummaryEnabled: boolean;
  preferredSendHour: string | number;
  recipientEmailsRaw?: string | null;
  replyToEmail?: string | null;
  shopDomain: string;
  timezoneOverride?: string | null;
  weeklySummaryEnabled: boolean;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const preferredSendHour = Number(args.preferredSendHour);
  if (!Number.isInteger(preferredSendHour) || preferredSendHour < 0 || preferredSendHour > 23) {
    throw new Error("Preferred send hour must be an integer between 0 and 23.");
  }

  const recipientEmails = parseNotificationRecipientsInput(args.recipientEmailsRaw);
  const replyToEmail = (args.replyToEmail ?? "").trim().toLowerCase() || null;
  const timezoneOverride = (args.timezoneOverride ?? "").trim() || null;

  return db.notificationPreference.upsert({
    where: {
      shopId: shop.id,
    },
    create: {
      alertDigestEnabled: args.alertDigestEnabled,
      dailySummaryEnabled: args.dailySummaryEnabled,
      preferredSendHour,
      recipientEmails,
      replyToEmail,
      shopId: shop.id,
      timezoneOverride,
      weeklySummaryEnabled: args.weeklySummaryEnabled,
    },
    update: {
      alertDigestEnabled: args.alertDigestEnabled,
      dailySummaryEnabled: args.dailySummaryEnabled,
      preferredSendHour,
      recipientEmails,
      replyToEmail,
      timezoneOverride,
      weeklySummaryEnabled: args.weeklySummaryEnabled,
    },
  });
}

export async function buildSettingsExportResponse(args: {
  exportKind: string;
  shopDomain: string;
}) {
  const exportKind = normalizeExportKind(args.exportKind);

  if (!exportKind) {
    throw new Error("Unsupported export request.");
  }

  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  if (exportKind === "alerts_csv") {
    const alerts = await db.alert.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        detectedForDate: "desc",
      },
      select: {
        alertType: true,
        completenessLevel: true,
        currencyCode: true,
        detectedForDate: true,
        entityKey: true,
        entityType: true,
        impactAmount: true,
        severity: true,
        status: true,
        title: true,
      },
      take: 5000,
    });

    return new Response(
      renderAlertsExportCsv(
        alerts.map((alert) => ({
          ...alert,
          impactAmount: alert.impactAmount?.toString() ?? null,
        })),
      ),
      {
        headers: {
          "Content-Disposition": `attachment; filename="profit-guard-alerts-${shop.shopDomain}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      },
    );
  }

  if (exportKind === "costs_csv") {
    const [variantCosts, supplierContracts, categoryProfiles] = await Promise.all([
      db.variantCost.findMany({
        where: {
          shopId: shop.id,
          effectiveTo: null,
        },
        orderBy: {
          effectiveFrom: "desc",
        },
      }),
      db.supplierContractProfile.findMany({
        where: {
          shopId: shop.id,
          effectiveTo: null,
        },
        orderBy: [
          {
            vendorName: "asc",
          },
          {
            productType: "asc",
          },
        ],
      }),
      db.categoryCostProfile.findMany({
        where: {
          shopId: shop.id,
        },
        orderBy: {
          categoryKey: "asc",
        },
      }),
    ]);

    return new Response(
      renderCostsExportCsv({
        categoryProfiles: categoryProfiles.map((profile) => ({
          categoryKey: profile.categoryKey,
          defaultCostRate: profile.defaultCostRate.toString(),
          importedBatchKey: profile.importedBatchKey,
          notes: profile.notes,
        })),
        supplierContracts: supplierContracts.map((contract) => ({
          currencyCode: contract.currencyCode,
          effectiveFrom: contract.effectiveFrom,
          effectiveTo: contract.effectiveTo,
          importedBatchKey: contract.importedBatchKey,
          notes: contract.notes,
          productType: contract.productType,
          unitCostAmount: contract.unitCostAmount.toString(),
          vendorName: contract.vendorName,
        })),
        variantCosts: variantCosts.map((cost) => ({
          costAmount: cost.costAmount.toString(),
          currencyCode: cost.currencyCode,
          effectiveFrom: cost.effectiveFrom,
          effectiveTo: cost.effectiveTo,
          importedBatchKey: cost.importedBatchKey,
          notes: cost.notes,
          sku: cost.sku,
          sourceType: cost.sourceType,
          variantId: cost.variantId,
        })),
      }),
      {
        headers: {
          "Content-Disposition": `attachment; filename="profit-guard-costs-${shop.shopDomain}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      },
    );
  }

  if (exportKind === "summaries_json") {
    const reports = await db.reportSnapshot.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: [
        {
          reportType: "asc",
        },
        {
          periodEnd: "desc",
        },
      ],
      select: {
        createdAt: true,
        id: true,
        payload: true,
        periodEnd: true,
        periodStart: true,
        reportType: true,
        updatedAt: true,
      },
      take: 500,
    });

    return new Response(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          reports: reports.map((report) => ({
            createdAt: report.createdAt.toISOString(),
            id: report.id,
            payload: report.payload,
            periodEnd: report.periodEnd.toISOString(),
            periodStart: report.periodStart.toISOString(),
            reportType: report.reportType,
            updatedAt: report.updatedAt.toISOString(),
          })),
          shopDomain: shop.shopDomain,
        },
        null,
        2,
      ),
      {
        headers: {
          "Content-Disposition": `attachment; filename="profit-guard-summaries-${shop.shopDomain}.json"`,
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  }

  const [
    shopRecord,
    subscriptions,
    billingEvents,
    notificationPreference,
    reports,
    reportExports,
    digestDeliveries,
    alertThreads,
    alerts,
    alertFeedbacks,
    alertStatusHistory,
    savedViews,
    transactionFeeProfiles,
    syncRuns,
    webhookEvents,
    variantCosts,
    supplierContracts,
    categoryProfiles,
  ] = await Promise.all([
    db.shop.findUniqueOrThrow({
      where: {
        id: shop.id,
      },
      select: {
        backfillStatus: true,
        countryCode: true,
        createdAt: true,
        currencyCode: true,
        currentPlan: true,
        email: true,
        ianaTimezone: true,
        id: true,
        installedAt: true,
        isActive: true,
        lastSyncedAt: true,
        planName: true,
        primaryDomain: true,
        shopDomain: true,
        shopName: true,
        subscriptionStatus: true,
        uninstalledAt: true,
        updatedAt: true,
      },
    }),
    db.billingSubscription.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    db.billingEvent.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 500,
      select: {
        createdAt: true,
        eventType: true,
        id: true,
        processedAt: true,
        shopifyChargeId: true,
      },
    }),
    db.notificationPreference.findUnique({
      where: {
        shopId: shop.id,
      },
    }),
    db.reportSnapshot.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: [
        {
          reportType: "asc",
        },
        {
          periodEnd: "desc",
        },
      ],
      take: 500,
      select: {
        createdAt: true,
        id: true,
        payload: true,
        periodEnd: true,
        periodStart: true,
        reportType: true,
        updatedAt: true,
      },
    }),
    db.reportExport.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 500,
      select: {
        createdAt: true,
        exportFormat: true,
        id: true,
        reportType: true,
        status: true,
        storageKey: true,
        updatedAt: true,
      },
    }),
    db.digestDelivery.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 500,
      select: {
        attemptCount: true,
        createdAt: true,
        deliveredAt: true,
        exportFormat: true,
        id: true,
        lastAttemptAt: true,
        lastError: true,
        recipientEmail: true,
        reportSnapshotId: true,
        reportType: true,
        status: true,
        subject: true,
        updatedAt: true,
      },
    }),
    db.alertThread.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 2000,
      select: {
        alertType: true,
        createdAt: true,
        entityKey: true,
        entityType: true,
        firstDetectedAt: true,
        id: true,
        isOpen: true,
        lastDetectedAt: true,
        ownerAssignedAt: true,
        ownerName: true,
        reviewedAt: true,
        reviewerName: true,
        updatedAt: true,
        workflowNote: true,
      },
    }),
    db.alert.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        detectedForDate: "desc",
      },
      take: 5000,
      select: {
        alertType: true,
        completenessLevel: true,
        confidenceLevel: true,
        createdAt: true,
        currencyCode: true,
        detectedForDate: true,
        entityKey: true,
        entityType: true,
        firstDetectedAt: true,
        id: true,
        impactAmount: true,
        lastDetectedAt: true,
        rankScore: true,
        severity: true,
        status: true,
        threadId: true,
        title: true,
        updatedAt: true,
      },
    }),
    db.alertFeedback.findMany({
      where: {
        alert: {
          shopId: shop.id,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5000,
      select: {
        actorId: true,
        actorType: true,
        alertId: true,
        createdAt: true,
        feedback: true,
        id: true,
        note: true,
      },
    }),
    db.alertStatusHistory.findMany({
      where: {
        alert: {
          shopId: shop.id,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5000,
      select: {
        actorId: true,
        actorType: true,
        alertId: true,
        createdAt: true,
        fromStatus: true,
        id: true,
        note: true,
        toStatus: true,
      },
    }),
    db.alertSavedView.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: [
        {
          visibility: "asc",
        },
        {
          updatedAt: "desc",
        },
      ],
      take: 500,
    }),
    db.transactionFeeProfile.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        effectiveFrom: "desc",
      },
      take: 500,
    }),
    db.syncRun.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 1000,
      select: {
        createdAt: true,
        errorMessage: true,
        finishedAt: true,
        id: true,
        recordsSynced: true,
        recordsTotal: true,
        runType: true,
        startedAt: true,
        status: true,
      },
    }),
    db.webhookEvent.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        receivedAt: "desc",
      },
      take: 1000,
      select: {
        apiVersion: true,
        errorMessage: true,
        id: true,
        processedAt: true,
        receivedAt: true,
        status: true,
        topic: true,
        webhookId: true,
      },
    }),
    db.variantCost.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        effectiveFrom: "desc",
      },
      take: 5000,
    }),
    db.supplierContractProfile.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        effectiveFrom: "desc",
      },
      take: 2000,
    }),
    db.categoryCostProfile.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        categoryKey: "asc",
      },
      take: 2000,
    }),
  ]);

  const portabilityBundle = buildPortableDataPackagePayload({
    alerts: alerts.map((alert) => ({
      ...alert,
      impactAmount: toStringOrNull(alert.impactAmount),
      rankScore: toStringOrNull(alert.rankScore),
    })),
    alertFeedbacks,
    alertStatusHistory,
    alertThreads,
    billingEvents,
      notificationPreference: notificationPreference
      ? {
          alertDigestEnabled: notificationPreference.alertDigestEnabled,
          createdAt: notificationPreference.createdAt,
          dailySummaryEnabled: notificationPreference.dailySummaryEnabled,
          preferredSendHour: notificationPreference.preferredSendHour,
          recipientEmails: Array.isArray(notificationPreference.recipientEmails)
            ? notificationPreference.recipientEmails.filter((value): value is string => typeof value === "string")
            : [],
          replyToEmail: notificationPreference.replyToEmail,
          timezoneOverride: notificationPreference.timezoneOverride,
          updatedAt: notificationPreference.updatedAt,
          weeklySummaryEnabled: notificationPreference.weeklySummaryEnabled,
        }
      : null,
    categoryProfiles: categoryProfiles.map((profile) => ({
      ...profile,
      defaultCostRate: profile.defaultCostRate.toString(),
    })),
      reportExports,
      digestDeliveries,
      reports,
    savedViews,
    shop: shopRecord,
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      priceAmount: toStringOrNull(subscription.priceAmount),
    })),
    supplierContracts: supplierContracts.map((contract) => ({
      ...contract,
      unitCostAmount: contract.unitCostAmount.toString(),
    })),
    syncRuns,
    transactionFeeProfiles: transactionFeeProfiles.map((profile) => ({
      ...profile,
      fixedFeeAmount: profile.fixedFeeAmount.toString(),
      percentageRate: profile.percentageRate.toString(),
    })),
    variantCosts: variantCosts.map((cost) => ({
      ...cost,
      costAmount: cost.costAmount.toString(),
    })),
    webhookEvents,
  });

  return new Response(JSON.stringify(portabilityBundle, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="profit-guard-portability-${shop.shopDomain}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
