import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { ReportType } from "@prisma/client";
import prisma from "../../../../packages/db/src/client";
import {
  generateReportSnapshot,
  getReportsOverview,
  prepareDigestDeliveries,
} from "../../../web/app/services/reports.server";
import { runDigestDispatchCycle } from "../services/digest-dispatch";
import { processNextSyncRun } from "../services/sync-runner";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(SCRIPT_DIR, "../../../../.env") });

const DEFAULT_SHOP_DOMAIN = "xn-427a29cs6k5qhhyxv12c2rhn0k.myshopify.com";
const REQUIRED_SCOPES = ["write_orders", "write_products"];
const SEED_TAG = "profit_guard_seed_v20260415";
const SEED_NOTE = "Profit Guard real-store validation seed";
const MAX_SYNC_RUN_ATTEMPTS = 12;
const ORDER_CREATE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

type GraphqlUserError = {
  field?: string[] | null;
  message: string;
};

type ProductSeed = {
  handle: string;
  optionName: string;
  productType: string;
  tags: string[];
  title: string;
  vendor: string;
  variants: Array<{
    compareAtPrice: number;
    cost: number;
    optionValue: string;
    price: number;
    sku: string;
  }>;
};

type SeedOrderDraft = {
  createdOrderKey: string;
  discount?: {
    amount?: number;
    code: string;
    percentage?: number;
  };
  items: Array<{
    quantity: number;
    sku: string;
  }>;
  processedAt: string;
  refunds?: Array<{
    amount: number;
    note: string;
    quantity: number;
    sku: string;
  }>;
  shippingAmount: number;
  shippingTitle: string;
  sourceName: string;
  tags: string[];
  test: boolean;
  countryCode: "AU" | "CA" | "US";
  city: string;
  provinceCode: string;
  zip: string;
};

type ProductQueryResponse = {
  products: {
    nodes: Array<{
      handle: string;
      id: string;
      productType: string | null;
      tags: string[];
      title: string;
      vendor: string | null;
      variants: {
        nodes: Array<{
          id: string;
          price: string | null;
          sku: string | null;
          title: string;
        }>;
      };
    }>;
  };
};

type OrderQueryResponse = {
  orders: {
    nodes: Array<{
      currentTotalPriceSet: {
        shopMoney: {
          amount: string;
          currencyCode: string;
        } | null;
      } | null;
      id: string;
      lineItems: {
        nodes: Array<{
          id: string;
          quantity: number;
          sku: string | null;
        }>;
      };
      name: string;
      processedAt: string | null;
      refunds: Array<{ id: string }>;
      sourceName: string | null;
      tags: string[];
    }>;
  };
};

type ProductCreateResponse = {
  productCreate: {
    product: {
      handle: string;
      id: string;
      options: Array<{
        id: string;
        name: string;
      }>;
    } | null;
    userErrors: GraphqlUserError[];
  };
};

type ProductVariantsBulkCreateResponse = {
  productVariantsBulkCreate: {
    productVariants: Array<{
      id: string;
      price: string | null;
      sku: string | null;
      title: string;
    }>;
    userErrors: GraphqlUserError[];
  };
};

type OrderCreateResponse = {
  orderCreate: {
    order: {
      currentTotalPriceSet: {
        shopMoney: {
          amount: string;
          currencyCode: string;
        } | null;
      } | null;
      id: string;
      lineItems: {
        nodes: Array<{
          id: string;
          quantity: number;
          sku: string | null;
        }>;
      };
      name: string;
      processedAt: string | null;
      tags: string[];
    } | null;
    userErrors: GraphqlUserError[];
  };
};

type RefundCreateResponse = {
  refundCreate: {
    refund: {
      id: string;
      totalRefundedSet: {
        shopMoney: {
          amount: string;
          currencyCode: string;
        } | null;
      } | null;
    } | null;
    userErrors: GraphqlUserError[];
  };
};

const SEED_PRODUCTS: ProductSeed[] = [
  {
    handle: "profit-guard-seed-core-tee",
    optionName: "Size",
    productType: "Apparel",
    tags: [SEED_TAG, "baseline", "profit-guard-seed"],
    title: "Profit Guard Core Tee",
    vendor: "Acme Supply",
    variants: [
      { compareAtPrice: 49, cost: 18, optionValue: "S", price: 39, sku: "PG-SEED-TEE-S" },
      { compareAtPrice: 49, cost: 18, optionValue: "M", price: 39, sku: "PG-SEED-TEE-M" },
      { compareAtPrice: 49, cost: 18, optionValue: "L", price: 39, sku: "PG-SEED-TEE-L" },
    ],
  },
  {
    handle: "profit-guard-seed-clearance-hoodie",
    optionName: "Size",
    productType: "Clearance",
    tags: [SEED_TAG, "promo", "low-margin", "profit-guard-seed"],
    title: "Profit Guard Clearance Hoodie",
    vendor: "Acme Supply",
    variants: [
      { compareAtPrice: 99, cost: 58, optionValue: "S", price: 79, sku: "PG-SEED-HOODIE-S" },
      { compareAtPrice: 99, cost: 58, optionValue: "M", price: 79, sku: "PG-SEED-HOODIE-M" },
    ],
  },
  {
    handle: "profit-guard-seed-accessory-pack",
    optionName: "Pack",
    productType: "Accessories",
    tags: [SEED_TAG, "bundle", "profit-guard-seed"],
    title: "Profit Guard Accessory Pack",
    vendor: "Northwind",
    variants: [
      { compareAtPrice: 24, cost: 6, optionValue: "Single", price: 19, sku: "PG-SEED-ACC-SINGLE" },
      { compareAtPrice: 44, cost: 12, optionValue: "Duo", price: 34, sku: "PG-SEED-ACC-DUO" },
    ],
  },
];

const SEED_ORDERS: SeedOrderDraft[] = [
  {
    createdOrderKey: "pg-seed-a1",
    items: [{ quantity: 2, sku: "PG-SEED-TEE-M" }],
    processedAt: "2026-04-13T02:15:00.000Z",
    shippingAmount: 6,
    shippingTitle: "Standard shipping",
    sourceName: "online_store",
    tags: [SEED_TAG, "seed-day-a", "baseline"],
    test: true,
    countryCode: "US",
    city: "Los Angeles",
    provinceCode: "CA",
    zip: "90001",
  },
  {
    createdOrderKey: "pg-seed-a2",
    items: [
      { quantity: 1, sku: "PG-SEED-ACC-DUO" },
      { quantity: 1, sku: "PG-SEED-TEE-S" },
    ],
    processedAt: "2026-04-13T05:30:00.000Z",
    shippingAmount: 5,
    shippingTitle: "Tracked parcel",
    sourceName: "online_store",
    tags: [SEED_TAG, "seed-day-a", "baseline"],
    test: true,
    countryCode: "CA",
    city: "Toronto",
    provinceCode: "ON",
    zip: "M5H 2N2",
  },
  {
    createdOrderKey: "pg-seed-a3",
    discount: {
      amount: 4,
      code: "EMAIL4",
    },
    items: [{ quantity: 3, sku: "PG-SEED-ACC-SINGLE" }],
    processedAt: "2026-04-13T09:45:00.000Z",
    shippingAmount: 4,
    shippingTitle: "Economy shipping",
    sourceName: "email_campaign",
    tags: [SEED_TAG, "seed-day-a", "baseline"],
    test: true,
    countryCode: "US",
    city: "Seattle",
    provinceCode: "WA",
    zip: "98101",
  },
  {
    createdOrderKey: "pg-seed-b1",
    discount: {
      code: "META35",
      percentage: 35,
    },
    items: [{ quantity: 1, sku: "PG-SEED-HOODIE-M" }],
    processedAt: "2026-04-14T01:20:00.000Z",
    refunds: [{ amount: 51.35, note: "Seed promo refund", quantity: 1, sku: "PG-SEED-HOODIE-M" }],
    shippingAmount: 8,
    shippingTitle: "Priority shipping",
    sourceName: "facebook_ads",
    tags: [SEED_TAG, "seed-day-b", "promo"],
    test: true,
    countryCode: "AU",
    city: "Sydney",
    provinceCode: "NSW",
    zip: "2000",
  },
  {
    createdOrderKey: "pg-seed-b2",
    discount: {
      code: "META35",
      percentage: 35,
    },
    items: [{ quantity: 1, sku: "PG-SEED-HOODIE-S" }],
    processedAt: "2026-04-14T02:10:00.000Z",
    refunds: [{ amount: 51.35, note: "Seed second promo refund", quantity: 1, sku: "PG-SEED-HOODIE-S" }],
    shippingAmount: 8,
    shippingTitle: "Priority shipping",
    sourceName: "facebook_ads",
    tags: [SEED_TAG, "seed-day-b", "promo"],
    test: true,
    countryCode: "AU",
    city: "Melbourne",
    provinceCode: "VIC",
    zip: "3000",
  },
  {
    createdOrderKey: "pg-seed-b3",
    discount: {
      code: "META30",
      percentage: 30,
    },
    items: [{ quantity: 2, sku: "PG-SEED-HOODIE-M" }],
    processedAt: "2026-04-14T04:25:00.000Z",
    shippingAmount: 10,
    shippingTitle: "Express shipping",
    sourceName: "facebook_ads",
    tags: [SEED_TAG, "seed-day-b", "promo"],
    test: true,
    countryCode: "US",
    city: "Austin",
    provinceCode: "TX",
    zip: "73301",
  },
  {
    createdOrderKey: "pg-seed-b4",
    discount: {
      code: "TIKTOK25",
      percentage: 25,
    },
    items: [
      { quantity: 1, sku: "PG-SEED-HOODIE-S" },
      { quantity: 1, sku: "PG-SEED-ACC-SINGLE" },
    ],
    processedAt: "2026-04-14T06:40:00.000Z",
    shippingAmount: 9,
    shippingTitle: "Express shipping",
    sourceName: "tiktok_ads",
    tags: [SEED_TAG, "seed-day-b", "promo"],
    test: true,
    countryCode: "US",
    city: "Chicago",
    provinceCode: "IL",
    zip: "60601",
  },
  {
    createdOrderKey: "pg-seed-b5",
    discount: {
      amount: 15,
      code: "CLEAR15",
    },
    items: [
      { quantity: 1, sku: "PG-SEED-TEE-L" },
      { quantity: 1, sku: "PG-SEED-HOODIE-M" },
    ],
    processedAt: "2026-04-14T10:05:00.000Z",
    shippingAmount: 8,
    shippingTitle: "Tracked parcel",
    sourceName: "online_store",
    tags: [SEED_TAG, "seed-day-b", "promo"],
    test: true,
    countryCode: "CA",
    city: "Vancouver",
    provinceCode: "BC",
    zip: "V5K 0A1",
  },
  {
    createdOrderKey: "pg-seed-c1",
    discount: {
      code: "RET20",
      percentage: 20,
    },
    items: [{ quantity: 1, sku: "PG-SEED-HOODIE-M" }],
    processedAt: "2026-04-15T01:15:00.000Z",
    refunds: [{ amount: 63.2, note: "Seed full refund", quantity: 1, sku: "PG-SEED-HOODIE-M" }],
    shippingAmount: 6,
    shippingTitle: "Tracked parcel",
    sourceName: "tiktok_ads",
    tags: [SEED_TAG, "seed-day-c", "refund"],
    test: true,
    countryCode: "AU",
    city: "Brisbane",
    provinceCode: "QLD",
    zip: "4000",
  },
  {
    createdOrderKey: "pg-seed-c2",
    discount: {
      code: "RET20",
      percentage: 20,
    },
    items: [{ quantity: 1, sku: "PG-SEED-HOODIE-S" }],
    processedAt: "2026-04-15T02:20:00.000Z",
    refunds: [{ amount: 63.2, note: "Seed second refund", quantity: 1, sku: "PG-SEED-HOODIE-S" }],
    shippingAmount: 6,
    shippingTitle: "Tracked parcel",
    sourceName: "tiktok_ads",
    tags: [SEED_TAG, "seed-day-c", "refund"],
    test: true,
    countryCode: "AU",
    city: "Perth",
    provinceCode: "WA",
    zip: "6000",
  },
  {
    createdOrderKey: "pg-seed-c3",
    items: [{ quantity: 1, sku: "PG-SEED-ACC-DUO" }],
    processedAt: "2026-04-15T05:00:00.000Z",
    shippingAmount: 4,
    shippingTitle: "Economy shipping",
    sourceName: "online_store",
    tags: [SEED_TAG, "seed-day-c"],
    test: true,
    countryCode: "AU",
    city: "Adelaide",
    provinceCode: "SA",
    zip: "5000",
  },
  {
    createdOrderKey: "pg-seed-c4",
    items: [{ quantity: 1, sku: "PG-SEED-TEE-M" }],
    processedAt: "2026-04-15T07:10:00.000Z",
    shippingAmount: 5,
    shippingTitle: "Standard shipping",
    sourceName: "online_store",
    tags: [SEED_TAG, "seed-day-c"],
    test: true,
    countryCode: "US",
    city: "New York",
    provinceCode: "NY",
    zip: "10001",
  },
];

function toMoneyBag(amount: number, currencyCode: string) {
  return {
    shopMoney: {
      amount: amount.toFixed(2),
      currencyCode,
    },
  };
}

function formatUserErrors(userErrors: GraphqlUserError[]) {
  return userErrors
    .map((error) => {
      const field = error.field?.length ? error.field.join(".") : "unknown";
      return `${field}: ${error.message}`;
    })
    .join("; ");
}

function assertUserErrors(userErrors: GraphqlUserError[], context: string) {
  if (userErrors.length === 0) {
    return;
  }

  throw new Error(`${context} failed: ${formatUserErrors(userErrors)}`);
}

function hasRetryableUserErrors(userErrors: GraphqlUserError[]) {
  return userErrors.some((error) => /too many attempts|try again later/i.test(error.message));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertRequiredScopes(scope: string | null | undefined) {
  const scopeSet = new Set((scope ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  const missingScopes = REQUIRED_SCOPES.filter((requiredScope) => !scopeSet.has(requiredScope));

  if (missingScopes.length === 0) {
    return;
  }

  throw new Error(
    `Missing required Shopify scopes: ${missingScopes.join(", ")}. Re-open the app in the dev store and approve the updated scopes before retrying.`,
  );
}

function listMissingScopes(scope: string | null | undefined) {
  const scopeSet = new Set((scope ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  return REQUIRED_SCOPES.filter((requiredScope) => !scopeSet.has(requiredScope));
}

async function refreshOfflineAccessToken(args: {
  refreshToken: string;
  shopDomain: string;
}) {
  assert.ok(process.env.SHOPIFY_API_KEY, "SHOPIFY_API_KEY is required to refresh Shopify offline sessions.");
  assert.ok(process.env.SHOPIFY_API_SECRET, "SHOPIFY_API_SECRET is required to refresh Shopify offline sessions.");

  const response = await fetch(`https://${args.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
    }),
  });

  const rawPayload = await response.text();
  let payload: {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  try {
    payload = JSON.parse(rawPayload) as typeof payload;
  } catch {
    throw new Error(`Failed to refresh Shopify offline token: HTTP ${response.status} ${rawPayload.slice(0, 300)}`);
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `Failed to refresh Shopify offline token: HTTP ${response.status} ${payload.error_description ?? payload.error ?? JSON.stringify(payload)}`,
    );
  }

  return payload;
}

async function validateOfflineAccessToken(args: {
  accessToken: string;
  shopDomain: string;
}) {
  const response = await fetch(`https://${args.shopDomain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.accessToken,
    },
    body: JSON.stringify({
      query: `#graphql
        query ProfitGuardValidateOfflineToken {
          shop {
            myshopifyDomain
          }
        }
      `,
    }),
  });

  return response.ok;
}

async function ensureOfflineSessionWithRequiredScopes(shopDomain: string) {
  const sessionId = `offline_${shopDomain}`;
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
  });

  assert.ok(session, `Shopify offline session ${sessionId} is missing in Profit Guard database.`);

  let resolvedSession = session;
  const accessTokenLooksValid = resolvedSession.accessToken
    ? await validateOfflineAccessToken({
        accessToken: resolvedSession.accessToken,
        shopDomain,
      })
    : false;

  if (!accessTokenLooksValid && resolvedSession.refreshToken) {
    let refreshedToken;

    try {
      refreshedToken = await refreshOfflineAccessToken({
        refreshToken: resolvedSession.refreshToken,
        shopDomain,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Shopify offline session for ${shopDomain} is no longer usable and could not be refreshed. Re-open Profit Guard inside the Shopify admin once to mint a fresh offline session, then rerun seed-real-store. Original error: ${errorMessage}`,
      );
    }

    resolvedSession = await prisma.session.update({
      where: {
        id: sessionId,
      },
      data: {
        accessToken: refreshedToken.access_token,
        expires: refreshedToken.expires_in ? new Date(Date.now() + refreshedToken.expires_in * 1000) : resolvedSession.expires,
        refreshToken: refreshedToken.refresh_token ?? resolvedSession.refreshToken,
        refreshTokenExpires: refreshedToken.refresh_token_expires_in
          ? new Date(Date.now() + refreshedToken.refresh_token_expires_in * 1000)
          : resolvedSession.refreshTokenExpires,
        scope: refreshedToken.scope ?? resolvedSession.scope,
      },
    });
  }

  const missingScopes = listMissingScopes(resolvedSession.scope);

  if (missingScopes.length > 0) {
    throw new Error(
      `Missing required Shopify scopes: ${missingScopes.join(", ")}. Re-open the app in the dev store and approve the updated scopes before retrying.`,
    );
  }

  assert.ok(resolvedSession.accessToken, "Shopify offline access token is missing after refresh.");

  return resolvedSession;
}

async function graphqlRequest<TData>(args: {
  accessToken: string;
  query: string;
  shopDomain: string;
  variables?: Record<string, unknown>;
}) {
  const response = await fetch(`https://${args.shopDomain}/admin/api/2026-04/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": args.accessToken,
    },
    body: JSON.stringify({
      query: args.query,
      variables: args.variables ?? {},
    }),
  });

  const payload = (await response.json()) as {
    data?: TData;
    errors?: Array<{ message: string }>;
  };

  if (!response.ok) {
    throw new Error(`Shopify GraphQL request failed with HTTP ${response.status}: ${JSON.stringify(payload.errors ?? payload)}`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("Shopify GraphQL request returned no data.");
  }

  return payload.data;
}

async function getSeededProducts(args: {
  accessToken: string;
  shopDomain: string;
}) {
  const data = await graphqlRequest<ProductQueryResponse>({
    accessToken: args.accessToken,
    query: `#graphql
      query ProfitGuardSeedProducts($query: String!) {
        products(first: 20, query: $query, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            title
            handle
            vendor
            productType
            tags
            variants(first: 20) {
              nodes {
                id
                sku
                title
                price
              }
            }
          }
        }
      }
    `,
    shopDomain: args.shopDomain,
    variables: {
      query: `tag:${SEED_TAG}`,
    },
  });

  return data.products.nodes;
}

async function getSeededOrders(args: {
  accessToken: string;
  shopDomain: string;
}) {
  const data = await graphqlRequest<OrderQueryResponse>({
    accessToken: args.accessToken,
    query: `#graphql
      query ProfitGuardSeedOrders($query: String!) {
        orders(first: 50, query: $query, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            id
            name
            tags
            processedAt
            sourceName
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 20) {
              nodes {
                id
                sku
                quantity
              }
            }
            refunds {
              id
            }
          }
        }
      }
    `,
    shopDomain: args.shopDomain,
    variables: {
      query: `tag:${SEED_TAG}`,
    },
  });

  return data.orders.nodes;
}

async function ensureSeedProducts(args: {
  accessToken: string;
  currencyCode: string;
  shopDomain: string;
}) {
  const existingProducts = await getSeededProducts(args);
  const variantBySku = new Map<string, { id: string; price: string | null; title: string }>();

  for (const product of existingProducts) {
    for (const variant of product.variants.nodes) {
      if (variant.sku) {
        variantBySku.set(variant.sku, {
          id: variant.id,
          price: variant.price,
          title: variant.title,
        });
      }
    }
  }

  const createdProducts: Array<{ handle: string; productId: string }> = [];
  const createdVariants: string[] = [];

  for (const seedProduct of SEED_PRODUCTS) {
    const alreadySeeded = seedProduct.variants.every((variant) => variantBySku.has(variant.sku));
    if (alreadySeeded) {
      continue;
    }

    const productCreateData = await graphqlRequest<ProductCreateResponse>({
      accessToken: args.accessToken,
      query: `#graphql
        mutation ProfitGuardSeedProductCreate($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              id
              handle
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      shopDomain: args.shopDomain,
      variables: {
        product: {
          handle: seedProduct.handle,
          productOptions: [
            {
              name: seedProduct.optionName,
              position: 1,
              values: seedProduct.variants.map((variant) => ({
                name: variant.optionValue,
              })),
            },
          ],
          productType: seedProduct.productType,
          status: "ACTIVE",
          tags: seedProduct.tags,
          title: seedProduct.title,
          vendor: seedProduct.vendor,
        },
      },
    });

    assertUserErrors(productCreateData.productCreate.userErrors, `productCreate(${seedProduct.handle})`);
    const createdProduct = productCreateData.productCreate.product;
    assert.ok(createdProduct, `productCreate(${seedProduct.handle}) should return a product`);

    const variantsData = await graphqlRequest<ProductVariantsBulkCreateResponse>({
      accessToken: args.accessToken,
      query: `#graphql
        mutation ProfitGuardSeedProductVariants(
          $productId: ID!
          $strategy: ProductVariantsBulkCreateStrategy
          $variants: [ProductVariantsBulkInput!]!
        ) {
          productVariantsBulkCreate(productId: $productId, strategy: $strategy, variants: $variants) {
            productVariants {
              id
              title
              sku
              price
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      shopDomain: args.shopDomain,
      variables: {
        productId: createdProduct.id,
        strategy: "REMOVE_STANDALONE_VARIANT",
        variants: seedProduct.variants.map((variant) => ({
          compareAtPrice: variant.compareAtPrice.toFixed(2),
          inventoryItem: {
            cost: variant.cost.toFixed(2),
            requiresShipping: true,
            sku: variant.sku,
            tracked: false,
          },
          inventoryPolicy: "CONTINUE",
          optionValues: [
            {
              name: variant.optionValue,
              optionName: seedProduct.optionName,
            },
          ],
          price: variant.price.toFixed(2),
          taxable: true,
        })),
      },
    });

    assertUserErrors(
      variantsData.productVariantsBulkCreate.userErrors,
      `productVariantsBulkCreate(${seedProduct.handle})`,
    );

    createdProducts.push({
      handle: seedProduct.handle,
      productId: createdProduct.id,
    });

    for (const variant of variantsData.productVariantsBulkCreate.productVariants) {
      if (variant.sku) {
        variantBySku.set(variant.sku, {
          id: variant.id,
          price: variant.price,
          title: variant.title,
        });
        createdVariants.push(variant.sku);
      }
    }
  }

  for (const seedProduct of SEED_PRODUCTS) {
    for (const variant of seedProduct.variants) {
      assert.ok(variantBySku.has(variant.sku), `Missing seeded variant ${variant.sku}`);
    }
  }

  return {
    createdProducts,
    createdVariants,
    variantBySku,
  };
}

async function ensureLocalCostProfiles(args: {
  currencyCode: string;
  shopId: string;
}) {
  await prisma.transactionFeeProfile.upsert({
    where: {
      id: `pg-seed-fee-${args.shopId}`,
    },
    update: {
      currencyCode: args.currencyCode,
      fixedFeeAmount: "0.3000",
      isDefault: true,
      percentageRate: "0.0290",
    },
    create: {
      currencyCode: args.currencyCode,
      fixedFeeAmount: "0.3000",
      id: `pg-seed-fee-${args.shopId}`,
      isDefault: true,
      percentageRate: "0.0290",
      shopId: args.shopId,
    },
  });

  await prisma.supplierContractProfile.deleteMany({
    where: {
      importedBatchKey: SEED_TAG,
      shopId: args.shopId,
    },
  });

  await prisma.supplierContractProfile.createMany({
    data: [
      {
        currencyCode: args.currencyCode,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        importedBatchKey: SEED_TAG,
        notes: SEED_NOTE,
        productType: "Apparel",
        shopId: args.shopId,
        unitCostAmount: "18.0000",
        vendorName: "Acme Supply",
      },
      {
        currencyCode: args.currencyCode,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        importedBatchKey: SEED_TAG,
        notes: SEED_NOTE,
        productType: "Clearance",
        shopId: args.shopId,
        unitCostAmount: "58.0000",
        vendorName: "Acme Supply",
      },
      {
        currencyCode: args.currencyCode,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        importedBatchKey: SEED_TAG,
        notes: SEED_NOTE,
        productType: "Accessories",
        shopId: args.shopId,
        unitCostAmount: "6.0000",
        vendorName: "Northwind",
      },
    ],
  });

  await prisma.notificationPreference.upsert({
    where: {
      shopId: args.shopId,
    },
    update: {
      alertDigestEnabled: true,
      dailySummaryEnabled: true,
      preferredSendHour: 8,
      recipientEmails: [process.env.PROFIT_GUARD_SUPPORT_EMAIL || "support@example.com"],
      replyToEmail: process.env.PROFIT_GUARD_SUPPORT_EMAIL || "support@example.com",
      timezoneOverride: "UTC",
      weeklySummaryEnabled: true,
    },
    create: {
      alertDigestEnabled: true,
      dailySummaryEnabled: true,
      preferredSendHour: 8,
      recipientEmails: [process.env.PROFIT_GUARD_SUPPORT_EMAIL || "support@example.com"],
      replyToEmail: process.env.PROFIT_GUARD_SUPPORT_EMAIL || "support@example.com",
      shopId: args.shopId,
      timezoneOverride: "UTC",
      weeklySummaryEnabled: true,
    },
  });
}

function estimateOrderSubtotal(args: {
  items: SeedOrderDraft["items"];
  variantBySku: Map<string, { id: string; price: string | null; title: string }>;
}) {
  return args.items.reduce((total, item) => {
    const variant = args.variantBySku.get(item.sku);
    assert.ok(variant?.price, `Missing seeded variant price for ${item.sku}`);
    return total + Number(variant.price) * item.quantity;
  }, 0);
}

function estimateDiscountAmount(args: {
  draft: SeedOrderDraft;
  subtotalAmount: number;
}) {
  if (!args.draft.discount) {
    return 0;
  }

  if (typeof args.draft.discount.percentage === "number") {
    return Number((args.subtotalAmount * (args.draft.discount.percentage / 100)).toFixed(2));
  }

  return Number((args.draft.discount.amount ?? 0).toFixed(2));
}

function buildSeedOrderSignature(args: {
  items: Array<{ quantity: number; sku: string }>;
  processedAt: string;
  sourceName: string;
}) {
  const itemSignature = args.items
    .map((item) => `${item.sku}:${item.quantity}`)
    .sort()
    .join("|");

  return `${args.processedAt}::${args.sourceName}::${itemSignature}`;
}

async function createSeedOrders(args: {
  accessToken: string;
  currencyCode: string;
  shopDomain: string;
  variantBySku: Map<string, { id: string; price: string | null; title: string }>;
}) {
  const existingOrders = await getSeededOrders({
    accessToken: args.accessToken,
    shopDomain: args.shopDomain,
  });
  const existingOrdersBySeedKey = new Map<string, (typeof existingOrders)[number]>();
  const existingOrdersBySignature = new Map<string, (typeof existingOrders)[number]>();

  for (const order of existingOrders) {
    for (const tag of order.tags) {
      if (tag.startsWith("seed-key::")) {
        existingOrdersBySeedKey.set(tag.slice("seed-key::".length), order);
      }
    }

    if (order.processedAt && order.sourceName) {
      const signature = buildSeedOrderSignature({
        items: order.lineItems.nodes
          .filter((lineItem): lineItem is { id: string; quantity: number; sku: string } => Boolean(lineItem.sku))
          .map((lineItem) => ({
            quantity: lineItem.quantity,
            sku: lineItem.sku,
          })),
        processedAt: order.processedAt,
        sourceName: order.sourceName,
      });

      if (!existingOrdersBySignature.has(signature)) {
        existingOrdersBySignature.set(signature, order);
      }
    }
  }

  const createdOrders: Array<{
    currentTotalAmount: number;
    id: string;
    lineItems: Array<{ id: string; quantity: number; sku: string | null }>;
    name: string;
  }> = [];
  const createdRefunds: Array<{ id: string; orderId: string }> = [];
  let blockedReason: string | null = null;
  let remainingDraftKeys: string[] = [];

  orderLoop: for (const [draftIndex, draft] of SEED_ORDERS.entries()) {
    const draftSignature = buildSeedOrderSignature({
      items: draft.items,
      processedAt: draft.processedAt,
      sourceName: draft.sourceName,
    });
    const matchedExistingOrder =
      existingOrdersBySeedKey.get(draft.createdOrderKey) ??
      existingOrdersBySignature.get(draftSignature) ??
      null;

    let seededOrder = matchedExistingOrder
      ? {
          currentTotalAmount: Number(matchedExistingOrder.currentTotalPriceSet?.shopMoney?.amount ?? 0),
          id: matchedExistingOrder.id,
          lineItems: matchedExistingOrder.lineItems.nodes,
          name: matchedExistingOrder.name,
          refundsCount: matchedExistingOrder.refunds.length,
        }
      : null;

    const subtotalAmount = estimateOrderSubtotal({
      items: draft.items,
      variantBySku: args.variantBySku,
    });
    const discountAmount = estimateDiscountAmount({
      draft,
      subtotalAmount,
    });
    const totalAmount = Number((subtotalAmount - discountAmount + draft.shippingAmount).toFixed(2));

    if (!seededOrder) {
      let orderCreateData: OrderCreateResponse | null = null;

      for (let attempt = 0; attempt <= ORDER_CREATE_RETRY_DELAYS_MS.length; attempt += 1) {
        orderCreateData = await graphqlRequest<OrderCreateResponse>({
          accessToken: args.accessToken,
          query: `#graphql
            mutation ProfitGuardSeedOrderCreate($order: OrderCreateOrderInput!) {
              orderCreate(order: $order) {
                order {
                  id
                  name
                  processedAt
                  tags
                  currentTotalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  lineItems(first: 20) {
                    nodes {
                      id
                      quantity
                      sku
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          shopDomain: args.shopDomain,
          variables: {
            order: {
              currency: args.currencyCode,
              discountCode: draft.discount
                ? typeof draft.discount.percentage === "number"
                  ? {
                      itemPercentageDiscountCode: {
                        code: draft.discount.code,
                        percentage: draft.discount.percentage,
                      },
                    }
                  : {
                      itemFixedDiscountCode: {
                        amountSet: toMoneyBag(draft.discount.amount ?? 0, args.currencyCode),
                        code: draft.discount.code,
                      },
                    }
                : undefined,
              financialStatus: "PAID",
              lineItems: draft.items.map((item) => ({
                quantity: item.quantity,
                variantId: args.variantBySku.get(item.sku)?.id,
              })),
              note: SEED_NOTE,
              processedAt: draft.processedAt,
              shippingAddress: {
                city: draft.city,
                countryCode: draft.countryCode,
                provinceCode: draft.provinceCode,
                zip: draft.zip,
              },
              shippingLines: [
                {
                  code: draft.shippingTitle.toUpperCase().replace(/\s+/g, "_"),
                  priceSet: toMoneyBag(draft.shippingAmount, args.currencyCode),
                  source: "profit-guard-seed",
                  title: draft.shippingTitle,
                },
              ],
              sourceIdentifier: draft.createdOrderKey,
              sourceName: draft.sourceName,
              tags: [...new Set([...draft.tags, `seed-key::${draft.createdOrderKey}`])],
              test: draft.test,
              transactions: [
                {
                  amountSet: toMoneyBag(totalAmount, args.currencyCode),
                  gateway: "manual",
                  kind: "SALE",
                  processedAt: draft.processedAt,
                  status: "SUCCESS",
                  test: draft.test,
                },
              ],
            },
          },
        });

        if (!hasRetryableUserErrors(orderCreateData.orderCreate.userErrors)) {
          break;
        }

        const retryDelay = ORDER_CREATE_RETRY_DELAYS_MS[attempt];

        if (retryDelay === undefined) {
          break;
        }

        await sleep(retryDelay);
      }

      assert.ok(orderCreateData, `orderCreate(${draft.createdOrderKey}) should return a payload`);
      if (hasRetryableUserErrors(orderCreateData.orderCreate.userErrors)) {
        blockedReason = `Shopify rate limited seed order creation at ${draft.createdOrderKey}: ${formatUserErrors(orderCreateData.orderCreate.userErrors)}`;
        remainingDraftKeys = SEED_ORDERS.slice(draftIndex).map((remainingDraft) => remainingDraft.createdOrderKey);
        break orderLoop;
      }
      assertUserErrors(orderCreateData.orderCreate.userErrors, `orderCreate(${draft.createdOrderKey})`);
      const createdOrder = orderCreateData.orderCreate.order;
      assert.ok(createdOrder, `orderCreate(${draft.createdOrderKey}) should return an order`);

      seededOrder = {
        currentTotalAmount: Number(createdOrder.currentTotalPriceSet?.shopMoney?.amount ?? totalAmount.toFixed(2)),
        id: createdOrder.id,
        lineItems: createdOrder.lineItems.nodes,
        name: createdOrder.name,
        refundsCount: 0,
      };

      createdOrders.push({
        currentTotalAmount: seededOrder.currentTotalAmount,
        id: seededOrder.id,
        lineItems: seededOrder.lineItems,
        name: seededOrder.name,
      });
    }

    const refundDraftsToCreate = (draft.refunds ?? []).slice(seededOrder.refundsCount);

    for (const refundDraft of refundDraftsToCreate) {
      await sleep(1_000);
      const refundedLineItem = seededOrder.lineItems.find((lineItem) => lineItem.sku === refundDraft.sku);
      assert.ok(refundedLineItem, `Missing line item ${refundDraft.sku} for refund seed`);
      const refundIdempotencyKey = `${draft.createdOrderKey}:${refundDraft.sku}:${refundDraft.quantity}:${refundDraft.amount.toFixed(2)}`;

      let refundData: RefundCreateResponse | null = null;

      for (let attempt = 0; attempt <= ORDER_CREATE_RETRY_DELAYS_MS.length; attempt += 1) {
        refundData = await graphqlRequest<RefundCreateResponse>({
          accessToken: args.accessToken,
          query: `#graphql
            mutation ProfitGuardSeedRefundCreate($input: RefundInput!) {
              refundCreate(input: $input) @idempotent(key: "${refundIdempotencyKey}") {
                refund {
                  id
                  totalRefundedSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          shopDomain: args.shopDomain,
          variables: {
            input: {
              allowOverRefunding: false,
              note: refundDraft.note,
              notify: false,
              orderId: seededOrder.id,
              processedAt: new Date(new Date(draft.processedAt).getTime() + 60 * 60 * 1000).toISOString(),
              refundLineItems: [
                {
                  lineItemId: refundedLineItem.id,
                  quantity: refundDraft.quantity,
                  restockType: "NO_RESTOCK",
                },
              ],
              transactions: [
                {
                  amount: refundDraft.amount.toFixed(2),
                  gateway: "cash",
                  kind: "REFUND",
                  orderId: seededOrder.id,
                },
              ],
            },
          },
        });

        if (!hasRetryableUserErrors(refundData.refundCreate.userErrors)) {
          break;
        }

        const retryDelay = ORDER_CREATE_RETRY_DELAYS_MS[attempt];

        if (retryDelay === undefined) {
          break;
        }

        await sleep(retryDelay);
      }

      assert.ok(refundData, `refundCreate(${draft.createdOrderKey}) should return a payload`);
      if (hasRetryableUserErrors(refundData.refundCreate.userErrors)) {
        blockedReason = `Shopify rate limited refund creation at ${draft.createdOrderKey}: ${formatUserErrors(refundData.refundCreate.userErrors)}`;
        remainingDraftKeys = SEED_ORDERS.slice(draftIndex).map((remainingDraft) => remainingDraft.createdOrderKey);
        break orderLoop;
      }
      assertUserErrors(refundData.refundCreate.userErrors, `refundCreate(${draft.createdOrderKey})`);
      const refund = refundData.refundCreate.refund;
      assert.ok(refund, `refundCreate(${draft.createdOrderKey}) should return a refund`);
      createdRefunds.push({
        id: refund.id,
        orderId: seededOrder.id,
      });
    }
  }

  const refreshedOrders = await getSeededOrders({
    accessToken: args.accessToken,
    shopDomain: args.shopDomain,
  });

  return {
    blockedReason,
    createdOrders,
    createdRefunds,
    existingOrders: refreshedOrders,
    remainingDraftKeys,
    skipped: createdOrders.length === 0 && createdRefunds.length === 0,
  };
}

async function main() {
  const shopDomain = process.argv[2] || process.env.PROFIT_GUARD_DEV_STORE_DOMAIN || DEFAULT_SHOP_DOMAIN;
  const shop = await prisma.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      currencyCode: true,
      id: true,
      shopDomain: true,
    },
  });

  assert.ok(shop, `Shop ${shopDomain} not found in Profit Guard database.`);

  const offlineSession = await ensureOfflineSessionWithRequiredScopes(shopDomain);
  assertRequiredScopes(offlineSession.scope);
  const accessToken = offlineSession.accessToken;

  const currencyCode = shop.currencyCode ?? "USD";

  await ensureLocalCostProfiles({
    currencyCode,
    shopId: shop.id,
  });

  const seededProducts = await ensureSeedProducts({
    accessToken,
    currencyCode,
    shopDomain,
  });

  const seededOrders = await createSeedOrders({
    accessToken,
    currencyCode,
    shopDomain,
    variantBySku: seededProducts.variantBySku,
  });

  await prisma.syncRun.create({
    data: {
      shopId: shop.id,
      runType: "SHOP_BOOTSTRAP",
      status: "QUEUED",
      metadata: {
        trigger: "real_store_seed",
        seedTag: SEED_TAG,
      },
    },
  });

  for (let attempt = 0; attempt < MAX_SYNC_RUN_ATTEMPTS; attempt += 1) {
    const processed = await processNextSyncRun();

    if (!processed) {
      break;
    }
  }

  const [dailyReport, weeklyReport] = await Promise.all([
    generateReportSnapshot({
      reportType: ReportType.DAILY,
      shopDomain,
    }),
    generateReportSnapshot({
      reportType: ReportType.WEEKLY,
      shopDomain,
    }),
  ]);

  const [preparedDailyDigest, preparedWeeklyDigest] = await Promise.all([
    prepareDigestDeliveries({
      reportType: ReportType.DAILY,
      shopDomain,
    }),
    prepareDigestDeliveries({
      reportType: ReportType.WEEKLY,
      shopDomain,
    }),
  ]);

  const digestDispatch = await runDigestDispatchCycle({
    deliveryLimit: 10,
    now: new Date(),
  });

  const [overview, alertsByType, dailyMetrics, channelMetrics, orderRollup, localCounts] = await Promise.all([
    getReportsOverview(shopDomain),
    prisma.alert.groupBy({
      by: ["alertType"],
      _count: {
        _all: true,
      },
      where: {
        shopId: shop.id,
      },
      orderBy: {
        alertType: "asc",
      },
    }),
    prisma.dailyShopMetric.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        metricDate: "asc",
      },
    }),
    prisma.dailyChannelMetric.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: [
        {
          metricDate: "asc",
        },
        {
          channelKey: "asc",
        },
      ],
    }),
    prisma.order.groupBy({
      by: ["customerCountryCode", "sourceName"],
      _count: {
        _all: true,
      },
      orderBy: [
        {
          customerCountryCode: "asc",
        },
        {
          sourceName: "asc",
        },
      ],
      where: {
        shopId: shop.id,
      },
    }),
    Promise.all([
      prisma.product.count({ where: { shopId: shop.id } }),
      prisma.variant.count({ where: { shopId: shop.id } }),
      prisma.order.count({ where: { shopId: shop.id } }),
      prisma.refund.count({ where: { shopId: shop.id } }),
    ]),
  ]);

  console.info(
    JSON.stringify(
      {
        digestDispatch,
        digests: {
          dailyPrepared: preparedDailyDigest.preparedCount,
          emailProviderReady: process.env.PROFIT_GUARD_EMAIL_PROVIDER === "resend" && Boolean(process.env.RESEND_API_KEY),
          recentDigestDeliveries: overview?.recentDigestDeliveries.length ?? 0,
          weeklyPrepared: preparedWeeklyDigest.preparedCount,
        },
        localCounts: {
          orders: localCounts[2],
          products: localCounts[0],
          refunds: localCounts[3],
          variants: localCounts[1],
        },
        reports: {
          dailyHeadline: dailyReport.snapshot.payload.narrative.headline,
          dailyPeriod: dailyReport.snapshot.payload.period.label,
          weeklyHeadline: weeklyReport.snapshot.payload.narrative.headline,
          weeklyPeriod: weeklyReport.snapshot.payload.period.label,
        },
        seed: {
          blockedReason: seededOrders.blockedReason,
          createdOrderCount: seededOrders.createdOrders.length,
          createdProductCount: seededProducts.createdProducts.length,
          createdRefundCount: seededOrders.createdRefunds.length,
          existingSeededOrderCount: seededOrders.existingOrders.length,
          remainingDraftKeys: seededOrders.remainingDraftKeys,
          skippedOrderCreation: seededOrders.skipped,
          storeTag: SEED_TAG,
        },
        channelMetrics: channelMetrics.map((metric) => ({
          grossMarginRate: Number(metric.grossMarginRate ?? 0),
          grossSalesAmount: Number(metric.grossSalesAmount),
          metricDate: metric.metricDate.toISOString(),
          ordersCount: metric.ordersCount,
          channelKey: metric.channelKey,
        })),
        orderRollup,
        dailyMetrics: dailyMetrics.map((metric) => ({
          discountRate: Number(metric.discountRate ?? 0),
          grossMarginRate: Number(metric.grossMarginRate ?? 0),
          grossSalesAmount: Number(metric.grossSalesAmount),
          metricDate: metric.metricDate.toISOString(),
          ordersCount: metric.ordersCount,
          refundRate: Number(metric.refundRate ?? 0),
        })),
        alertsByType: alertsByType.map((entry) => ({
          alertType: entry.alertType,
          count: entry._count._all,
        })),
        backfill: await prisma.syncRun.findMany({
          where: {
            shopId: shop.id,
          },
          orderBy: {
            createdAt: "asc",
          },
          select: {
            runType: true,
            status: true,
            recordsSynced: true,
            errorMessage: true,
          },
        }),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[seed-real-store] failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
