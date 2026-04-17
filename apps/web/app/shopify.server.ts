import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import {
  BILLING_PLAN_CONFIG,
  BILLING_TEST_MODE,
  GROWTH_PLAN_KEY,
  STARTER_PLAN_KEY,
} from "./services/billing-config.server";
import { createLogger } from "./services/logger.server";
import { bootstrapShopAfterAuth } from "./services/platform.server";

const logger = createLogger("shopify");

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: BILLING_PLAN_CONFIG,
  hooks: {
    afterAuth: async ({ session, admin }) => {
      try {
        const registrationResult = await shopify.registerWebhooks({ session });

        logger.info("webhooks_registered_after_auth", {
          registrationResult,
          shopDomain: session.shop,
        });
      } catch (error) {
        logger.error("webhook_registration_failed_after_auth", {
          error: error instanceof Error ? error.message : String(error),
          shopDomain: session.shop,
        });
      }

      await bootstrapShopAfterAuth({ session, admin });
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const billingConfig = BILLING_PLAN_CONFIG;
export const billingSettings = {
  isTestMode: BILLING_TEST_MODE,
};
export const STARTER_PLAN = STARTER_PLAN_KEY;
export const GROWTH_PLAN = GROWTH_PLAN_KEY;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
