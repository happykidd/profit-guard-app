import assert from "node:assert/strict";
import test from "node:test";
import {
  getBillingReturnUrl,
  getManagedPricingSelectionUrl,
  resolveBillingPlanDetail,
} from "./billing-config.server";
import {
  extractBillingChargeReference,
  extractBillingChargeReferenceFromPayload,
} from "./billing.server";

test("getBillingReturnUrl points to dedicated billing return route", (t) => {
  const request = new Request("https://profit-guard-dev.example.com/app/billing");
  const originalAppUrl = process.env.SHOPIFY_APP_URL;

  process.env.SHOPIFY_APP_URL = "";
  t.after(() => {
    if (typeof originalAppUrl === "string") {
      process.env.SHOPIFY_APP_URL = originalAppUrl;
      return;
    }

    delete process.env.SHOPIFY_APP_URL;
  });

  assert.equal(
    getBillingReturnUrl(request),
    "https://profit-guard-dev.example.com/app/billing/return",
  );
});

test("getBillingReturnUrl preserves embedded Shopify app prefix when SHOPIFY_APP_URL includes a path", (t) => {
  const request = new Request("http://localhost:3458/app/billing");
  const originalAppUrl = process.env.SHOPIFY_APP_URL;

  process.env.SHOPIFY_APP_URL = "https://shopify.dev/apps/default-app-home";
  t.after(() => {
    if (typeof originalAppUrl === "string") {
      process.env.SHOPIFY_APP_URL = originalAppUrl;
      return;
    }

    delete process.env.SHOPIFY_APP_URL;
  });

  assert.equal(
    getBillingReturnUrl(request),
    "https://shopify.dev/apps/default-app-home/app/billing/return",
  );
});

test("extractBillingChargeReference resolves common Shopify billing query keys", () => {
  assert.equal(
    extractBillingChargeReference(new URLSearchParams("charge_id=12345")),
    "12345",
  );
  assert.equal(
    extractBillingChargeReference(new URLSearchParams("app_subscription_id=gid://shopify/AppSubscription/77")),
    "gid://shopify/AppSubscription/77",
  );
  assert.equal(extractBillingChargeReference(new URLSearchParams("")), null);
});

test("getManagedPricingSelectionUrl builds the Shopify-hosted plan picker URL", (t) => {
  const originalHandle = process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE;

  process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE = "profit-guard-22";
  t.after(() => {
    if (typeof originalHandle === "string") {
      process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE = originalHandle;
      return;
    }

    delete process.env.SHOPIFY_MANAGED_PRICING_APP_HANDLE;
  });

  assert.equal(
    getManagedPricingSelectionUrl("xn-427a29cs6k5qhhyxv12c2rhn0k.myshopify.com"),
    "https://admin.shopify.com/store/xn-427a29cs6k5qhhyxv12c2rhn0k/charges/profit-guard-22/pricing_plans",
  );
});

test("resolveBillingPlanDetail accepts Shopify display names", () => {
  assert.equal(resolveBillingPlanDetail("Starter")?.dbPlan, "STARTER");
  assert.equal(resolveBillingPlanDetail("Profit Guard Growth")?.dbPlan, "GROWTH");
  assert.equal(resolveBillingPlanDetail("Unknown"), null);
});

test("extractBillingChargeReferenceFromPayload resolves billing webhook payload ids", () => {
  assert.equal(
    extractBillingChargeReferenceFromPayload({
      admin_graphql_api_id: "gid://shopify/AppSubscription/101",
    }),
    "gid://shopify/AppSubscription/101",
  );
  assert.equal(extractBillingChargeReferenceFromPayload({}), null);
});
