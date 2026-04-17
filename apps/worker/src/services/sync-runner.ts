import { Prisma, SyncRunType } from "@prisma/client";
import prisma from "../../../../packages/db/src/client";
import { getDigestDispatchConfig, runDigestDispatchCycle } from "./digest-dispatch";
import { rebuildDailyMetrics } from "./daily-metrics";
import {
  runOrderBackfill,
  runProductBackfill,
} from "./shopify-sync";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const COMPLETED_RECORDS = 1;
const BACKFILL_RUNNING = "RUNNING";
const BACKFILL_COMPLETED = "COMPLETED";
const BACKFILL_FAILED = "FAILED";
const SYNC_STATUS_QUEUED = "QUEUED";
const SYNC_STATUS_RUNNING = "RUNNING";
const SYNC_STATUS_SUCCEEDED = "SUCCEEDED";
const SYNC_STATUS_FAILED = "FAILED";
const SYNC_STATUS_CANCELLED = "CANCELLED";
const SYNC_TYPE_SHOP_BOOTSTRAP = SyncRunType.SHOP_BOOTSTRAP;
const SYNC_TYPE_PRODUCT_BACKFILL = SyncRunType.PRODUCT_BACKFILL;
const SYNC_TYPE_ORDER_BACKFILL = SyncRunType.ORDER_BACKFILL;
const SYNC_TYPE_DAILY_REBUILD = SyncRunType.DAILY_REBUILD;
const BACKFILL_RUN_TYPES = [
  SYNC_TYPE_PRODUCT_BACKFILL,
  SYNC_TYPE_ORDER_BACKFILL,
  SYNC_TYPE_DAILY_REBUILD,
] as const;

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

async function loadClaimedSyncRun(runId: string) {
  return prisma.syncRun.findUnique({
    where: {
      id: runId,
    },
    include: {
      shop: {
        select: {
          id: true,
          shopDomain: true,
          isActive: true,
        },
      },
    },
  });
}

type ClaimedSyncRun = NonNullable<Awaited<ReturnType<typeof loadClaimedSyncRun>>>;

function getPollIntervalMs() {
  const rawValue = Number(process.env.WORKER_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);

  if (!Number.isFinite(rawValue) || rawValue < 1_000) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return rawValue;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function claimNextSyncRun() {
  const nextRun = await prisma.syncRun.findFirst({
    where: {
      status: SYNC_STATUS_QUEUED,
      shop: {
        isActive: true,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  if (!nextRun) {
    return null;
  }

  const claimCount = await prisma.syncRun.updateMany({
    where: {
      id: nextRun.id,
      status: SYNC_STATUS_QUEUED,
    },
    data: {
      status: SYNC_STATUS_RUNNING,
      startedAt: new Date(),
      errorMessage: null,
    },
  });

  if (claimCount.count === 0) {
    return null;
  }

  return loadClaimedSyncRun(nextRun.id) as Promise<ClaimedSyncRun | null>;
}

async function markRunSucceeded(
  run: ClaimedSyncRun,
  result?: {
    recordsTotal?: number;
    recordsSynced?: number;
    metadata?: Record<string, unknown>;
  },
) {
  const finishedAt = new Date();

  await prisma.syncRun.update({
    where: {
      id: run.id,
    },
    data: {
      status: SYNC_STATUS_SUCCEEDED,
      finishedAt,
      recordsTotal: result?.recordsTotal ?? COMPLETED_RECORDS,
      recordsSynced: result?.recordsSynced ?? COMPLETED_RECORDS,
      errorMessage: null,
      cursor: null,
      metadata: result?.metadata ? toJsonValue(result.metadata) : undefined,
    },
  });
}

async function markRunFailed(run: ClaimedSyncRun, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  await prisma.$transaction([
    prisma.syncRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: SYNC_STATUS_FAILED,
        finishedAt: new Date(),
        errorMessage,
      },
    }),
    prisma.shop.update({
      where: {
        id: run.shopId,
      },
      data: {
        backfillStatus: BACKFILL_FAILED,
      },
    }),
  ]);
}

async function ensureSyncRunQueued(
  tx: Prisma.TransactionClient,
  args: {
    shopId: string;
    runType: SyncRunType;
    metadata: Record<string, unknown>;
  },
) {
  const existingRun = await tx.syncRun.findFirst({
    where: {
      shopId: args.shopId,
      runType: args.runType,
      status: {
        in: [SYNC_STATUS_QUEUED, SYNC_STATUS_RUNNING],
      },
    },
    select: {
      id: true,
    },
  });

  if (existingRun) {
    return false;
  }

  await tx.syncRun.create({
    data: {
      shopId: args.shopId,
      runType: args.runType,
      status: SYNC_STATUS_QUEUED,
      metadata: toJsonValue(args.metadata),
    },
  });

  return true;
}

async function runShopBootstrap(run: ClaimedSyncRun) {
  const queuedRuns: string[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.shop.update({
      where: {
        id: run.shopId,
      },
      data: {
        backfillStatus: BACKFILL_RUNNING,
      },
    });

    if (
      await ensureSyncRunQueued(tx, {
        shopId: run.shopId,
        runType: SYNC_TYPE_PRODUCT_BACKFILL,
        metadata: {
          trigger: "shop_bootstrap",
          parentRunId: run.id,
        },
      })
    ) {
      queuedRuns.push(SYNC_TYPE_PRODUCT_BACKFILL);
    }

    if (
      await ensureSyncRunQueued(tx, {
        shopId: run.shopId,
        runType: SYNC_TYPE_ORDER_BACKFILL,
        metadata: {
          trigger: "shop_bootstrap",
          parentRunId: run.id,
        },
      })
    ) {
      queuedRuns.push(SYNC_TYPE_ORDER_BACKFILL);
    }
  });

  console.info("[worker] Running SHOP_BOOTSTRAP", {
    syncRunId: run.id,
    shop: run.shop.shopDomain,
  });

  await markRunSucceeded(run, {
    metadata: {
      followupRuns: queuedRuns,
    },
  });
}

async function updateShopBackfillState(shopId: string) {
  const pendingRuns = await prisma.syncRun.count({
    where: {
      shopId,
      runType: {
        in: [...BACKFILL_RUN_TYPES],
      },
      status: {
        in: [SYNC_STATUS_QUEUED, SYNC_STATUS_RUNNING],
      },
    },
  });

  await prisma.shop.update({
    where: {
      id: shopId,
    },
    data: {
      backfillStatus: pendingRuns > 0 ? BACKFILL_RUNNING : BACKFILL_COMPLETED,
      lastSyncedAt: pendingRuns > 0 ? undefined : new Date(),
    },
  });
}

async function runProductSync(run: ClaimedSyncRun) {
  await prisma.shop.update({
    where: {
      id: run.shopId,
    },
    data: {
      backfillStatus: BACKFILL_RUNNING,
    },
  });

  console.info("[worker] Running PRODUCT_BACKFILL", {
    syncRunId: run.id,
    shop: run.shop.shopDomain,
  });

  const result = await runProductBackfill({
    shopId: run.shopId,
    shopDomain: run.shop.shopDomain,
    runId: run.id,
  });

  await markRunSucceeded(run, result);
  await updateShopBackfillState(run.shopId);
}

async function runOrderSync(run: ClaimedSyncRun) {
  await prisma.shop.update({
    where: {
      id: run.shopId,
    },
    data: {
      backfillStatus: BACKFILL_RUNNING,
    },
  });

  console.info("[worker] Running ORDER_BACKFILL", {
    syncRunId: run.id,
    shop: run.shop.shopDomain,
  });

  const result = await runOrderBackfill({
    shopId: run.shopId,
    shopDomain: run.shop.shopDomain,
    runId: run.id,
  });

  await prisma.$transaction(async (tx) => {
    await ensureSyncRunQueued(tx, {
      shopId: run.shopId,
      runType: SYNC_TYPE_DAILY_REBUILD,
      metadata: {
        trigger: "order_backfill",
        parentRunId: run.id,
      },
    });
  });

  await markRunSucceeded(run, result);
  await updateShopBackfillState(run.shopId);
}

async function runDailyRebuild(run: ClaimedSyncRun) {
  await prisma.shop.update({
    where: {
      id: run.shopId,
    },
    data: {
      backfillStatus: BACKFILL_RUNNING,
    },
  });

  console.info("[worker] Running DAILY_REBUILD", {
    syncRunId: run.id,
    shop: run.shop.shopDomain,
  });

  const result = await rebuildDailyMetrics({
    shopId: run.shopId,
    runId: run.id,
  });

  await markRunSucceeded(run, result);
  await updateShopBackfillState(run.shopId);
}

async function processSyncRun(run: ClaimedSyncRun) {
  if (!run.shop.isActive) {
    await prisma.syncRun.update({
      where: {
        id: run.id,
      },
      data: {
        status: SYNC_STATUS_CANCELLED,
        finishedAt: new Date(),
        errorMessage: "Shop is inactive",
      },
    });

    return;
  }

  try {
    if (run.runType === SYNC_TYPE_SHOP_BOOTSTRAP) {
      await runShopBootstrap(run);
    } else if (run.runType === SYNC_TYPE_PRODUCT_BACKFILL) {
      await runProductSync(run);
    } else if (run.runType === SYNC_TYPE_ORDER_BACKFILL) {
      await runOrderSync(run);
    } else if (run.runType === SYNC_TYPE_DAILY_REBUILD) {
      await runDailyRebuild(run);
    } else {
      throw new Error(`No worker handler registered for sync run type: ${run.runType}`);
    }

    console.info("[worker] Sync run completed", {
      syncRunId: run.id,
      runType: run.runType,
      shop: run.shop.shopDomain,
    });
  } catch (error) {
    console.error("[worker] Sync run failed", {
      syncRunId: run.id,
      runType: run.runType,
      shop: run.shop.shopDomain,
      error: error instanceof Error ? error.message : String(error),
    });

    await markRunFailed(run, error);
  }
}

export async function processNextSyncRun() {
  const run = await claimNextSyncRun();

  if (!run) {
    return false;
  }

  await processSyncRun(run);

  return true;
}

export async function runSyncLoop() {
  const pollIntervalMs = getPollIntervalMs();
  const digestDispatchConfig = getDigestDispatchConfig();
  const runOnce = process.env.WORKER_RUN_ONCE === "true";
  let lastDigestRunAt = 0;

  console.info("[worker] Sync loop started", {
    digestDeliveryLimit: digestDispatchConfig.deliveryLimit,
    digestIntervalMs: digestDispatchConfig.intervalMs,
    digestSchedulerEnabled: digestDispatchConfig.schedulerEnabled,
    pollIntervalMs,
    runOnce,
  });

  do {
    const processedRun = await processNextSyncRun();
    const now = Date.now();

    if (now - lastDigestRunAt >= digestDispatchConfig.intervalMs) {
      const digestResult = await runDigestDispatchCycle();
      lastDigestRunAt = now;

      if (
        digestResult.preparedCount > 0 ||
        digestResult.processedCount > 0 ||
        digestResult.skippedReason !== null
      ) {
        console.info("[worker] Digest dispatch cycle completed", digestResult);
      }
    }

    if (!processedRun) {
      if (runOnce) {
        console.info("[worker] No queued sync runs found");
        return;
      }

      await sleep(pollIntervalMs);
    }
  } while (!runOnce);
}
