import db, { checkDatabaseConnection } from "../db.server";
import { getEmailDeliveryConfig } from "./email-delivery.server";
import { createLogger } from "./logger.server";

const logger = createLogger("health");

function emptyCounts() {
  return {
    syncRuns: {},
    webhooks: {},
  };
}

function toCountMap(rows: Array<{ status: string; _count: { _all: number } }>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});
}

export async function getHealthSnapshot() {
  const checkedAt = new Date().toISOString();
  const emailConfig = getEmailDeliveryConfig();

  try {
    await checkDatabaseConnection();

    const [syncRuns, webhooks] = await Promise.all([
      db.syncRun.groupBy({
        by: ["status"],
        _count: {
          _all: true,
        },
      }),
      db.webhookEvent.groupBy({
        by: ["status"],
        _count: {
          _all: true,
        },
      }),
    ]);

    const snapshot = {
      status: "ok",
      checkedAt,
      environment: process.env.NODE_ENV || "development",
      database: {
        ready: true,
      },
      queue: {
        syncRuns: toCountMap(syncRuns),
      },
      webhooks: {
        events: toCountMap(webhooks),
      },
      config: {
        digestSchedulerEnabled: process.env.PROFIT_GUARD_ENABLE_DIGEST_SCHEDULER === "true",
        emailProvider: emailConfig.provider,
        emailProviderReady: emailConfig.ready,
        shopifyApiKeyConfigured: Boolean(process.env.SHOPIFY_API_KEY),
        shopifyAppUrlConfigured: Boolean(process.env.SHOPIFY_APP_URL),
      },
    };

    logger.info("health_snapshot_ready", snapshot);
    return snapshot;
  } catch (error) {
    const snapshot = {
      status: "degraded",
      checkedAt,
      environment: process.env.NODE_ENV || "development",
      database: {
        ready: false,
        error: error instanceof Error ? error.message : String(error),
      },
      queue: emptyCounts(),
      webhooks: emptyCounts(),
      config: {
        digestSchedulerEnabled: process.env.PROFIT_GUARD_ENABLE_DIGEST_SCHEDULER === "true",
        emailProvider: emailConfig.provider,
        emailProviderReady: emailConfig.ready,
        shopifyApiKeyConfigured: Boolean(process.env.SHOPIFY_API_KEY),
        shopifyAppUrlConfigured: Boolean(process.env.SHOPIFY_APP_URL),
      },
    };

    logger.error("health_snapshot_failed", snapshot);
    return snapshot;
  }
}
