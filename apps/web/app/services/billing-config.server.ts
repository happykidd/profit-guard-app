import {
  BillingInterval,
  type BillingConfigSubscriptionLineItemPlan,
} from "@shopify/shopify-api";

export const STARTER_PLAN_KEY = "Profit Guard Starter";
export const GROWTH_PLAN_KEY = "Profit Guard Growth";
export type BillingMode = "manual" | "managed";

function readNumberEnv(name: string, fallback: number) {
  const rawValue = Number(process.env[name] ?? fallback);

  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return fallback;
  }

  return rawValue;
}

function readIntegerEnv(name: string, fallback: number) {
  const value = Math.floor(readNumberEnv(name, fallback));
  return value >= 0 ? value : fallback;
}

export const BILLING_CURRENCY = process.env.PROFIT_GUARD_BILLING_CURRENCY || "USD";
export const STARTER_PLAN_PRICE = readNumberEnv("PROFIT_GUARD_STARTER_PRICE", 29);
export const GROWTH_PLAN_PRICE = readNumberEnv("PROFIT_GUARD_GROWTH_PRICE", 79);
export const BILLING_TRIAL_DAYS = readIntegerEnv("PROFIT_GUARD_TRIAL_DAYS", 14);
export const BILLING_TEST_MODE = process.env.BILLING_TEST_MODE !== "false";
export const BILLING_MODE: BillingMode =
  process.env.SHOPIFY_BILLING_MODE === "manual" ? "manual" : "managed";

function createRecurringPlan(amount: number): BillingConfigSubscriptionLineItemPlan {
  return {
    trialDays: BILLING_TRIAL_DAYS,
    lineItems: [
      {
        amount,
        currencyCode: BILLING_CURRENCY,
        interval: BillingInterval.Every30Days,
      },
    ],
  };
}

export const BILLING_PLAN_CONFIG = {
  [STARTER_PLAN_KEY]: createRecurringPlan(STARTER_PLAN_PRICE),
  [GROWTH_PLAN_KEY]: createRecurringPlan(GROWTH_PLAN_PRICE),
} satisfies Record<string, BillingConfigSubscriptionLineItemPlan>;

export const BILLING_PLAN_DETAILS = [
  {
    key: STARTER_PLAN_KEY,
    dbPlan: "STARTER",
    title: "Starter",
    price: STARTER_PLAN_PRICE,
    currencyCode: BILLING_CURRENCY,
    description: "Built for merchants who are validating their first profit monitoring workflow.",
    features: [
      "Store-level profit health visibility",
      "Core margin alerts and platform status tracking",
      "Initial sync coverage and webhook lifecycle records",
    ],
  },
  {
    key: GROWTH_PLAN_KEY,
    dbPlan: "GROWTH",
    title: "Growth",
    price: GROWTH_PLAN_PRICE,
    currencyCode: BILLING_CURRENCY,
    description: "Built for growth-stage merchants who need a stronger operating cadence and denser alert coverage.",
    features: [
      "Everything in Starter",
      "More historical sync coverage and room for expanded AI summaries",
      "Higher headroom for multi-stage operating workflows",
    ],
  },
] as const;

const BILLING_PLAN_NAME_INDEX = BILLING_PLAN_DETAILS.map((plan) => ({
  ...plan,
  normalizedNames: Array.from(
    new Set([plan.key, plan.title].map((value) => value.trim().toLowerCase())),
  ),
}));

function buildEmbeddedAppUrl(baseUrl: string, pathname: string) {
  const url = new URL(baseUrl);
  const normalizedBasePath = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  url.pathname = `${normalizedBasePath}${normalizedPath}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function getAppBaseUrl(request: Request) {
  const appUrl = process.env.SHOPIFY_APP_URL;
  const baseUrl = appUrl && appUrl.length > 0 ? appUrl : new URL(request.url).origin;

  return {
    baseUrl,
    isConfigured: Boolean(appUrl && appUrl.length > 0),
  };
}

export function getBillingReturnUrl(request: Request) {
  const appUrl = getAppBaseUrl(request);
  return buildEmbeddedAppUrl(appUrl.baseUrl, "/app/billing/return");
}

export function getEmbeddedBillingUrl(request: Request) {
  const appUrl = getAppBaseUrl(request);
  return buildEmbeddedAppUrl(appUrl.baseUrl, "/app/billing");
}

export function isManagedBillingMode() {
  return BILLING_MODE === "managed";
}

export function resolveBillingPlanDetail(name: string) {
  const normalizedName = name.trim().toLowerCase();

  return (
    BILLING_PLAN_NAME_INDEX.find((plan) => plan.normalizedNames.includes(normalizedName)) ?? null
  );
}

export function getManagedPricingSelectionUrl(shopDomain: string) {
  const managedPricingAppHandle = process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE?.trim() || "";

  if (!managedPricingAppHandle) {
    throw new Error("SHOPIFY_MANAGED_PRICING_APP_HANDLE is required for managed billing mode.");
  }

  const storeHandle = shopDomain.replace(/\.myshopify\.com$/i, "");

  return `https://admin.shopify.com/store/${storeHandle}/charges/${managedPricingAppHandle}/pricing_plans`;
}
