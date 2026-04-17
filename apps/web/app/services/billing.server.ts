import { BillingPlan, Prisma, SubscriptionStatus } from "@prisma/client";
import db from "../db.server";
import {
  BILLING_PLAN_DETAILS,
  BILLING_TEST_MODE,
  BILLING_TRIAL_DAYS,
  GROWTH_PLAN_KEY,
  STARTER_PLAN_KEY,
  resolveBillingPlanDetail,
} from "./billing-config.server";
import { createLogger } from "./logger.server";

type MoneyLike = {
  amount: number;
  currencyCode: string;
};

type BillingSubscriptionLike = {
  id: string;
  name: string;
  test: boolean;
  trialDays: number;
  createdAt: string;
  currentPeriodEnd: string;
  returnUrl?: string | null;
  status: "ACTIVE" | "CANCELLED" | "PENDING" | "DECLINED" | "EXPIRED" | "FROZEN" | "ACCEPTED";
  lineItems: Array<{
    id: string;
    plan: {
      pricingDetails:
        | {
            interval?: string;
            price?: MoneyLike;
          }
        | {
            interval?: string;
            cappedAmount?: MoneyLike;
          };
    };
  }>;
};

type BillingCheckLike = {
  hasActivePayment: boolean;
  appSubscriptions: BillingSubscriptionLike[];
};

type BillingStateSummary = Awaited<ReturnType<typeof syncBillingState>>;

export type BillingEventSummary = {
  id: string;
  eventType: string;
  shopifyChargeId: string | null;
  processedAt: string | null;
  createdAt: string;
  payload: Record<string, unknown> | null;
};

const logger = createLogger("billing");

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function addDays(value: string | Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function mapPlanNameToDbPlan(planName: string): BillingPlan {
  const matchedPlan = resolveBillingPlanDetail(planName);

  if (matchedPlan?.dbPlan === "GROWTH") {
    return BillingPlan.GROWTH;
  }

  if (matchedPlan?.dbPlan === "STARTER") {
    return BillingPlan.STARTER;
  }

  if (planName === GROWTH_PLAN_KEY) {
    return BillingPlan.GROWTH;
  }

  if (planName === STARTER_PLAN_KEY) {
    return BillingPlan.STARTER;
  }

  return BillingPlan.FREE;
}

function isRecurringPricing(
  pricingDetails: BillingSubscriptionLike["lineItems"][number]["plan"]["pricingDetails"],
): pricingDetails is { interval?: string; price?: MoneyLike } {
  return "price" in pricingDetails;
}

function resolveSubscriptionStatus(subscription: BillingSubscriptionLike): SubscriptionStatus {
  const trialEndsAt =
    subscription.trialDays > 0 ? addDays(subscription.createdAt, subscription.trialDays) : null;

  if (subscription.status === "ACTIVE" && trialEndsAt && trialEndsAt > new Date()) {
    return SubscriptionStatus.TRIALING;
  }

  switch (subscription.status) {
    case "ACTIVE":
      return SubscriptionStatus.ACTIVE;
    case "PENDING":
    case "ACCEPTED":
      return SubscriptionStatus.PENDING;
    case "DECLINED":
      return SubscriptionStatus.DECLINED;
    case "EXPIRED":
      return SubscriptionStatus.EXPIRED;
    case "FROZEN":
      return SubscriptionStatus.FROZEN;
    case "CANCELLED":
    default:
      return SubscriptionStatus.CANCELLED;
  }
}

function getPrimaryRecurringLineItem(subscription: BillingSubscriptionLike) {
  return (
    subscription.lineItems.find((lineItem) => isRecurringPricing(lineItem.plan.pricingDetails)) ??
    null
  );
}

function comparePlanPriority(left: BillingPlan, right: BillingPlan) {
  const priority: Record<BillingPlan, number> = {
    FREE: 0,
    STARTER: 1,
    GROWTH: 2,
    PRO: 3,
  };

  return priority[left] - priority[right];
}

function pickPrimarySubscription(subscriptions: BillingSubscriptionLike[]) {
  return subscriptions.reduce<BillingSubscriptionLike | null>((selected, current) => {
    if (!selected) {
      return current;
    }

    const selectedPlan = mapPlanNameToDbPlan(selected.name);
    const currentPlan = mapPlanNameToDbPlan(current.name);

    if (comparePlanPriority(currentPlan, selectedPlan) > 0) {
      return current;
    }

    return selected;
  }, null);
}

function formatPlanPrice(planKey: string) {
  const plan =
    resolveBillingPlanDetail(planKey) ??
    BILLING_PLAN_DETAILS.find((item) => item.key === planKey) ??
    null;
  if (!plan) {
    return null;
  }

  return `${plan.currencyCode} ${plan.price}/30d`;
}

function toRecordValue(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function extractBillingChargeReference(searchParams: URLSearchParams) {
  const candidates = [
    searchParams.get("charge_id"),
    searchParams.get("chargeId"),
    searchParams.get("app_subscription_id"),
    searchParams.get("appSubscriptionId"),
  ];

  return candidates.find((value) => typeof value === "string" && value.length > 0) ?? null;
}

export function extractBillingChargeReferenceFromPayload(payload: Record<string, unknown>) {
  const candidates = [
    payload.admin_graphql_api_id,
    payload.app_subscription_id,
    payload.id,
    payload.charge_id,
  ];

  return (
    candidates.find((value): value is string => typeof value === "string" && value.length > 0) ??
    null
  );
}

async function ensureShop(shopDomain: string) {
  return db.shop.upsert({
    where: {
      shopDomain,
    },
    update: {
      isActive: true,
      uninstalledAt: null,
    },
    create: {
      shopDomain,
      isActive: true,
      trialEndsAt: addDays(new Date(), BILLING_TRIAL_DAYS),
    },
  });
}

export async function syncBillingState(params: {
  shopDomain: string;
  billingCheck: BillingCheckLike;
}) {
  const { billingCheck, shopDomain } = params;
  const shop = await ensureShop(shopDomain);
  const primarySubscription = pickPrimarySubscription(billingCheck.appSubscriptions);
  const nextPlan = primarySubscription
    ? mapPlanNameToDbPlan(primarySubscription.name)
    : BillingPlan.FREE;
  const nextStatus = primarySubscription
    ? resolveSubscriptionStatus(primarySubscription)
    : SubscriptionStatus.TRIALING;
  const nextTrialEndsAt = primarySubscription
    ? primarySubscription.trialDays > 0
      ? addDays(primarySubscription.createdAt, primarySubscription.trialDays)
      : null
    : shop.trialEndsAt ?? addDays(new Date(), BILLING_TRIAL_DAYS);
  const activeIds = billingCheck.appSubscriptions.map((subscription) => subscription.id);

  await db.$transaction(async (tx) => {
    await tx.shop.update({
      where: {
        id: shop.id,
      },
      data: {
        currentPlan: nextPlan,
        subscriptionStatus: nextStatus,
        trialEndsAt: nextTrialEndsAt,
      },
    });

    await tx.billingSubscription.updateMany({
      where: {
        shopId: shop.id,
        ...(activeIds.length > 0
          ? {
              NOT: {
                shopifyChargeId: {
                  in: activeIds,
                },
              },
            }
          : {}),
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PENDING,
          ],
        },
      },
      data: {
        status: SubscriptionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });

    for (const subscription of billingCheck.appSubscriptions) {
      const recurringLineItem = getPrimaryRecurringLineItem(subscription);
      const recurringPricingDetails =
        recurringLineItem && isRecurringPricing(recurringLineItem.plan.pricingDetails)
          ? recurringLineItem.plan.pricingDetails
          : null;
      const recurringPrice = recurringPricingDetails?.price;

      await tx.billingSubscription.upsert({
        where: {
          shopifyChargeId: subscription.id,
        },
        update: {
          plan: mapPlanNameToDbPlan(subscription.name),
          status: resolveSubscriptionStatus(subscription),
          interval: recurringPricingDetails?.interval ?? null,
          priceAmount:
            recurringPrice && Number.isFinite(recurringPrice.amount)
              ? recurringPrice.amount.toString()
              : null,
          currencyCode: recurringPrice?.currencyCode ?? null,
          trialDays: subscription.trialDays,
          currentPeriodStart: subscription.createdAt ? new Date(subscription.createdAt) : null,
          currentPeriodEnd: subscription.currentPeriodEnd
            ? new Date(subscription.currentPeriodEnd)
            : null,
          cancelledAt:
            subscription.status === "CANCELLED" ? new Date(subscription.currentPeriodEnd) : null,
          test: subscription.test,
          rawPayload: toJsonValue(subscription),
        },
        create: {
          shopId: shop.id,
          shopifyChargeId: subscription.id,
          plan: mapPlanNameToDbPlan(subscription.name),
          status: resolveSubscriptionStatus(subscription),
          interval: recurringPricingDetails?.interval ?? null,
          priceAmount:
            recurringPrice && Number.isFinite(recurringPrice.amount)
              ? recurringPrice.amount.toString()
              : null,
          currencyCode: recurringPrice?.currencyCode ?? null,
          trialDays: subscription.trialDays,
          currentPeriodStart: subscription.createdAt ? new Date(subscription.createdAt) : null,
          currentPeriodEnd: subscription.currentPeriodEnd
            ? new Date(subscription.currentPeriodEnd)
            : null,
          cancelledAt:
            subscription.status === "CANCELLED" ? new Date(subscription.currentPeriodEnd) : null,
          test: subscription.test,
          rawPayload: toJsonValue(subscription),
        },
      });
    }
  });

  logger.info("billing_state_synced", {
    shopDomain,
    hasActivePayment: billingCheck.hasActivePayment,
    activeSubscriptions: billingCheck.appSubscriptions.length,
    currentPlan: nextPlan,
    currentStatus: nextStatus,
  });

  return {
    hasActivePayment: billingCheck.hasActivePayment,
    currentPlan: nextPlan,
    subscriptionStatus: nextStatus,
    trialEndsAt: nextTrialEndsAt,
    appSubscriptions: billingCheck.appSubscriptions.map((subscription) => ({
      id: subscription.id,
      name: subscription.name,
      status: resolveSubscriptionStatus(subscription),
      test: subscription.test,
      trialDays: subscription.trialDays,
      currentPeriodEnd: subscription.currentPeriodEnd,
      displayPrice: formatPlanPrice(subscription.name),
    })),
  };
}

export async function recordBillingRequest(params: {
  shopDomain: string;
  planKey: string;
  returnUrl: string;
  mode?: "manual" | "managed";
}) {
  const { planKey, returnUrl, shopDomain, mode = "manual" } = params;
  const shop = await ensureShop(shopDomain);

  await db.billingEvent.create({
    data: {
      shopId: shop.id,
      eventType: "BILLING_REQUESTED",
      payload: toJsonValue({
        planKey,
        returnUrl,
        isTest: BILLING_TEST_MODE,
        mode,
      }),
      processedAt: new Date(),
    },
  });

  logger.info("billing_request_recorded", {
    shopDomain,
    planKey,
    returnUrl,
    isTest: BILLING_TEST_MODE,
    mode,
  });
}

export async function recordBillingReturn(params: {
  shopDomain: string;
  requestUrl: string;
  searchParams: URLSearchParams;
  billingState: BillingStateSummary;
}) {
  const { billingState, requestUrl, searchParams, shopDomain } = params;
  const shop = await ensureShop(shopDomain);
  const shopifyChargeId = extractBillingChargeReference(searchParams);
  const rawSearchParams = Object.fromEntries(searchParams.entries());

  await db.billingEvent.create({
    data: {
      shopId: shop.id,
      eventType: "BILLING_RETURNED",
      shopifyChargeId,
      payload: toJsonValue({
        requestUrl,
        searchParams: rawSearchParams,
        hasActivePayment: billingState.hasActivePayment,
        currentPlan: billingState.currentPlan,
        subscriptionStatus: billingState.subscriptionStatus,
        trialEndsAt: billingState.trialEndsAt?.toISOString() ?? null,
        subscriptions: billingState.appSubscriptions,
      }),
      processedAt: new Date(),
    },
  });

  logger.info("billing_return_recorded", {
    shopDomain,
    hasActivePayment: billingState.hasActivePayment,
    currentPlan: billingState.currentPlan,
    shopifyChargeId,
  });

  return {
    shopifyChargeId,
  };
}

export async function listRecentBillingEvents(params: {
  shopDomain: string;
  limit?: number;
}) {
  const { limit = 8, shopDomain } = params;
  const shop = await db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      id: true,
    },
  });

  if (!shop) {
    return [] as BillingEventSummary[];
  }

  const events = await db.billingEvent.findMany({
    where: {
      shopId: shop.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });

  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    shopifyChargeId: event.shopifyChargeId,
    processedAt: event.processedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    payload: toRecordValue(event.payload),
  })) satisfies BillingEventSummary[];
}

export function getBillingPlansForUi() {
  return BILLING_PLAN_DETAILS.map((plan) => ({
    ...plan,
    isTest: BILLING_TEST_MODE,
  }));
}

export async function fetchBillingStateFromShopify(shopDomain: string): Promise<BillingCheckLike> {
  const offlineSession = await db.session.findUnique({
    where: {
      id: `offline_${shopDomain}`,
    },
    select: {
      accessToken: true,
    },
  });

  if (!offlineSession?.accessToken) {
    throw new Error(`Offline session not found for ${shopDomain}`);
  }

  const query = `#graphql
    query ProfitGuardBillingState {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          test
          status
          createdAt
          currentPeriodEnd
          trialDays
          lineItems {
            id
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  interval
                  price {
                    amount
                    currencyCode
                  }
                }
                ... on AppUsagePricing {
                  interval
                  cappedAmount {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${shopDomain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": offlineSession.accessToken,
    },
    body: JSON.stringify({
      query,
    }),
  });

  if (!response.ok) {
    throw new Error(`Billing state query failed with HTTP ${response.status}`);
  }

  const result = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: Array<{
          id: string;
          name: string;
          test: boolean;
          status: BillingSubscriptionLike["status"];
          createdAt: string;
          currentPeriodEnd: string;
          trialDays: number;
          lineItems: BillingSubscriptionLike["lineItems"];
        }>;
      } | null;
    };
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(result.errors) && result.errors.length > 0) {
    throw new Error(
      `Billing state query returned GraphQL errors: ${result.errors
        .map((error) => error.message ?? "Unknown error")
        .join("; ")}`,
    );
  }

  const activeSubscriptions =
    result.data?.currentAppInstallation?.activeSubscriptions?.map((subscription) => ({
      ...subscription,
      returnUrl: null,
    })) ?? [];

  return {
    hasActivePayment: activeSubscriptions.length > 0,
    appSubscriptions: activeSubscriptions,
  };
}

export async function syncBillingStateFromShopify(shopDomain: string) {
  const billingCheck = await fetchBillingStateFromShopify(shopDomain);
  return syncBillingState({
    shopDomain,
    billingCheck,
  });
}

export async function recordBillingSubscriptionWebhook(params: {
  shopDomain: string;
  topic: string;
  payload: Record<string, unknown>;
  billingState: BillingStateSummary;
}) {
  const { billingState, payload, shopDomain, topic } = params;
  const shop = await ensureShop(shopDomain);
  const shopifyChargeId = extractBillingChargeReferenceFromPayload(payload);

  await db.billingEvent.create({
    data: {
      shopId: shop.id,
      eventType: "BILLING_SUBSCRIPTION_UPDATED",
      shopifyChargeId,
      payload: toJsonValue({
        topic,
        webhookPayload: payload,
        hasActivePayment: billingState.hasActivePayment,
        currentPlan: billingState.currentPlan,
        subscriptionStatus: billingState.subscriptionStatus,
        subscriptions: billingState.appSubscriptions,
      }),
      processedAt: new Date(),
    },
  });

  logger.info("billing_subscription_webhook_recorded", {
    shopDomain,
    topic,
    shopifyChargeId,
    currentPlan: billingState.currentPlan,
    subscriptionStatus: billingState.subscriptionStatus,
  });
}
