import {
  Prisma,
  SyncRunStatus,
  SyncRunType,
} from "@prisma/client";
import db from "../db.server";

type GraphqlAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type BootstrapSession = {
  shop: string;
};

type ShopifyShopBootstrapResponse = {
  data?: {
    shop?: {
      id?: string;
      name?: string;
      email?: string;
      primaryDomain?: {
        host?: string;
      } | null;
      billingAddress?: {
        country?: string;
      } | null;
      currencyCode?: string;
      ianaTimezone?: string;
      plan?: {
        displayName?: string;
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

type WebhookReceiptInput = {
  shopDomain?: string;
  topic: string;
  webhookId: string;
  apiVersion?: string;
  payload: unknown;
};

const SHOP_BOOTSTRAP_QUERY = `#graphql
  query ProfitGuardBootstrapShop {
    shop {
      id
      name
      email
      primaryDomain {
        host
      }
      billingAddress {
        country
      }
      currencyCode
      ianaTimezone
      plan {
        displayName
      }
    }
  }
`;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function ensureShopBootstrapRunQueued(
  tx: Prisma.TransactionClient,
  shopId: string,
) {
  const existingRun = await tx.syncRun.findFirst({
    where: {
      shopId,
      runType: SyncRunType.SHOP_BOOTSTRAP,
      status: {
        in: [SyncRunStatus.QUEUED, SyncRunStatus.RUNNING],
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
      shopId,
      runType: SyncRunType.SHOP_BOOTSTRAP,
      status: SyncRunStatus.QUEUED,
      metadata: toJsonValue({
        trigger: "after_auth",
      }),
    },
  });

  return true;
}

async function fetchShopMetadata(admin: GraphqlAdminClient) {
  const response = await admin.graphql(SHOP_BOOTSTRAP_QUERY);
  const result = (await response.json()) as ShopifyShopBootstrapResponse;

  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }

  const shop = result.data?.shop;
  if (!shop) {
    return null;
  }

  return {
    shopifyShopId: shop.id ?? null,
    shopName: shop.name ?? null,
    email: shop.email ?? null,
    primaryDomain: shop.primaryDomain?.host ?? null,
    countryCode: shop.billingAddress?.country ?? null,
    currencyCode: shop.currencyCode ?? null,
    ianaTimezone: shop.ianaTimezone ?? null,
    planName: shop.plan?.displayName ?? null,
  };
}

export async function bootstrapShopAfterAuth(params: {
  session: BootstrapSession;
  admin: GraphqlAdminClient;
}) {
  const { admin, session } = params;
  let metadata: Awaited<ReturnType<typeof fetchShopMetadata>> | null = null;

  try {
    metadata = await fetchShopMetadata(admin);
  } catch (error) {
    console.error("[platform] Failed to fetch shop metadata during bootstrap", {
      shop: session.shop,
      error: getErrorMessage(error),
    });
  }

  return db.$transaction(async (tx) => {
    const shopData = {
      shopifyShopId: metadata?.shopifyShopId ?? undefined,
      shopName: metadata?.shopName ?? undefined,
      email: metadata?.email ?? undefined,
      primaryDomain: metadata?.primaryDomain ?? undefined,
      countryCode: metadata?.countryCode ?? undefined,
      currencyCode: metadata?.currencyCode ?? undefined,
      ianaTimezone: metadata?.ianaTimezone ?? undefined,
      planName: metadata?.planName ?? undefined,
      isActive: true,
      uninstalledAt: null,
    };

    const existingShop = await tx.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true, backfillStatus: true },
    });

    if (existingShop) {
      const shop = await tx.shop.update({
        where: { shopDomain: session.shop },
        data: shopData,
      });

      if (existingShop.backfillStatus === "NOT_STARTED") {
        await ensureShopBootstrapRunQueued(tx, shop.id);
      }

      return shop;
    }

    try {
      const shop = await tx.shop.create({
        data: {
          shopDomain: session.shop,
          ...shopData,
        },
      });

      await ensureShopBootstrapRunQueued(tx, shop.id);

      return shop;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const shop = await tx.shop.update({
          where: { shopDomain: session.shop },
          data: shopData,
        });

        if (shop.backfillStatus === "NOT_STARTED") {
          await ensureShopBootstrapRunQueued(tx, shop.id);
        }

        return shop;
      }

      throw error;
    }
  });
}

export async function markShopUninstalled(shopDomain: string) {
  const uninstalledAt = new Date();

  return db.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({
      where: {
        shopDomain,
      },
      select: {
        id: true,
      },
    });

    if (!shop) {
      return {
        cancelledAlerts: 0,
        cancelledSyncRuns: 0,
        closedThreads: 0,
        shopUpdated: false,
      };
    }

    await tx.shop.update({
      where: {
        id: shop.id,
      },
      data: {
        currentPlan: "FREE",
        isActive: false,
        subscriptionStatus: "CANCELLED",
        trialEndsAt: null,
        uninstalledAt,
      },
    });

    await tx.billingSubscription.updateMany({
      where: {
        shopId: shop.id,
        status: {
          in: ["ACTIVE", "TRIALING", "PENDING", "FROZEN"],
        },
      },
      data: {
        cancelledAt: uninstalledAt,
        status: "CANCELLED",
      },
    });

    const cancelledSyncRunsResult = await tx.syncRun.updateMany({
      where: {
        shopId: shop.id,
        status: {
          in: [SyncRunStatus.QUEUED, SyncRunStatus.RUNNING],
        },
      },
      data: {
        errorMessage: "App uninstalled before sync completed.",
        finishedAt: uninstalledAt,
        status: SyncRunStatus.CANCELLED,
      },
    });

    const activeAlerts = await tx.alert.findMany({
      where: {
        shopId: shop.id,
        status: {
          in: ["NEW", "READ"],
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (activeAlerts.length > 0) {
      await tx.alert.updateMany({
        where: {
          id: {
            in: activeAlerts.map((alert) => alert.id),
          },
        },
        data: {
          status: "IGNORED",
        },
      });

      await tx.alertStatusHistory.createMany({
        data: activeAlerts.map((alert) => ({
          actorId: "app_uninstalled",
          actorType: "system",
          alertId: alert.id,
          fromStatus: alert.status,
          note: "Alert closed automatically because the app was uninstalled.",
          toStatus: "IGNORED",
        })),
      });
    }

    const closedThreadsResult = await tx.alertThread.updateMany({
      where: {
        shopId: shop.id,
        isOpen: true,
      },
      data: {
        isOpen: false,
      },
    });

    await tx.billingEvent.create({
      data: {
        eventType: "APP_UNINSTALLED",
        payload: {
          cancelledAlerts: activeAlerts.length,
          cancelledSyncRuns: cancelledSyncRunsResult.count,
          closedThreads: closedThreadsResult.count,
          shopDomain,
          uninstalledAt: uninstalledAt.toISOString(),
        },
        processedAt: uninstalledAt,
        shopId: shop.id,
      },
    });

    return {
      cancelledAlerts: activeAlerts.length,
      cancelledSyncRuns: cancelledSyncRunsResult.count,
      closedThreads: closedThreadsResult.count,
      shopUpdated: true,
    };
  });
}

export async function updateShopFromWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  await db.shop.upsert({
    where: { shopDomain },
    update: {
      shopifyShopId:
        typeof payload.id === "string" || typeof payload.id === "number"
          ? String(payload.id)
          : undefined,
      shopName: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      primaryDomain:
        typeof payload.domain === "string" ? payload.domain : undefined,
      countryCode:
        typeof payload.country_code === "string"
          ? payload.country_code
          : typeof payload.country === "string"
            ? payload.country
            : undefined,
      currencyCode:
        typeof payload.currency === "string" ? payload.currency : undefined,
      ianaTimezone:
        typeof payload.iana_timezone === "string"
          ? payload.iana_timezone
          : undefined,
      isActive: true,
      uninstalledAt: null,
    },
    create: {
      shopDomain,
      shopifyShopId:
        typeof payload.id === "string" || typeof payload.id === "number"
          ? String(payload.id)
          : undefined,
      shopName: typeof payload.name === "string" ? payload.name : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      primaryDomain:
        typeof payload.domain === "string" ? payload.domain : undefined,
      countryCode:
        typeof payload.country_code === "string"
          ? payload.country_code
          : typeof payload.country === "string"
            ? payload.country
            : undefined,
      currencyCode:
        typeof payload.currency === "string" ? payload.currency : undefined,
      ianaTimezone:
        typeof payload.iana_timezone === "string"
          ? payload.iana_timezone
          : undefined,
      isActive: true,
    },
  });
}

export async function updateScopesFromWebhook(
  shopDomain: string,
  payload: Record<string, unknown>,
) {
  const rawCurrent = payload.current;
  const scope =
    Array.isArray(rawCurrent) && rawCurrent.every((value) => typeof value === "string")
      ? rawCurrent.join(",")
      : typeof rawCurrent === "string"
        ? rawCurrent
        : null;

  if (!scope) {
    return;
  }

  await db.session.updateMany({
    where: { shop: shopDomain },
    data: { scope },
  });
}

export async function recordWebhookReceipt(input: WebhookReceiptInput) {
  const existing = await db.webhookEvent.findUnique({
    where: {
      topic_webhookId: {
        topic: input.topic,
        webhookId: input.webhookId,
      },
    },
  });

  if (existing) {
    return { event: existing, duplicate: true };
  }

  const shop = input.shopDomain
    ? await db.shop.findUnique({
        where: { shopDomain: input.shopDomain },
        select: { id: true },
      })
    : null;

  try {
    const event = await db.webhookEvent.create({
      data: {
        shopId: shop?.id,
        topic: input.topic,
        webhookId: input.webhookId,
        apiVersion: input.apiVersion,
        payload: toJsonValue(input.payload),
      },
    });

    return { event, duplicate: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const duplicateEvent = await db.webhookEvent.findUniqueOrThrow({
        where: {
          topic_webhookId: {
            topic: input.topic,
            webhookId: input.webhookId,
          },
        },
      });

      return { event: duplicateEvent, duplicate: true };
    }

    throw error;
  }
}

export async function markWebhookProcessed(eventId: string) {
  await db.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

export async function markWebhookFailed(eventId: string, error: unknown) {
  await db.webhookEvent.update({
    where: { id: eventId },
    data: {
      status: "FAILED",
      errorMessage: getErrorMessage(error),
    },
  });
}
