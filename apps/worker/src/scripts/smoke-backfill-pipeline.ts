if (!process.env.SHOPIFY_APP_URL) {
  process.env.SHOPIFY_APP_URL = "https://profit-guard.test";
}

if (!process.env.SHOPIFY_API_KEY) {
  process.env.SHOPIFY_API_KEY = "dummy-key";
}

if (!process.env.SHOPIFY_API_SECRET) {
  process.env.SHOPIFY_API_SECRET = "dummy-secret";
}

import prisma from "../../../../packages/db/src/client";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const shopDomain = `smoke-${Date.now()}.myshopify.com`;
  const [{ processNextSyncRun }, { unauthenticated }] = await Promise.all([
    import("../services/sync-runner"),
    import("../../../../apps/web/app/shopify.server"),
  ]);

  const originalAdmin = unauthenticated.admin;

  unauthenticated.admin = async () =>
    ({
      admin: {
        graphql: async (query: string) => {
          if (query.includes("ProfitGuardBackfillProducts")) {
            return new Response(
              JSON.stringify({
                data: {
                  products: {
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null,
                    },
                    nodes: [
                      {
                        id: "gid://shopify/Product/9001",
                        title: "Profit Guard Tee",
                        handle: "profit-guard-tee",
                        vendor: "Profit Guard",
                        productType: "Apparel",
                        status: "ACTIVE",
                        tags: ["profit-guard", "smoke"],
                        createdAt: "2026-04-01T00:00:00.000Z",
                        updatedAt: "2026-04-14T00:00:00.000Z",
                        variants: {
                          nodes: [
                            {
                              id: "gid://shopify/ProductVariant/9101",
                              sku: "PG-TEE-001",
                              title: "Black / M",
                              price: "29.00",
                              compareAtPrice: "35.00",
                              inventoryQuantity: 8,
                              inventoryItem: {
                                measurement: {
                                  weight: {
                                    value: 0.35,
                                    unit: "KILOGRAMS",
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }

          if (query.includes("ProfitGuardBackfillOrders")) {
            return new Response(
              JSON.stringify({
                data: {
                  orders: {
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null,
                    },
                    nodes: [
                      {
                        id: "gid://shopify/Order/9201",
                        name: "#1001",
                        processedAt: "2026-04-14T03:00:00.000Z",
                        createdAt: "2026-04-14T02:58:00.000Z",
                        updatedAt: "2026-04-14T03:05:00.000Z",
                        currencyCode: "USD",
                        sourceName: "online_store",
                        test: false,
                        shippingAddress: {
                          countryCodeV2: "US",
                        },
                        subtotalPriceSet: {
                          shopMoney: {
                            amount: "29.00",
                            currencyCode: "USD",
                          },
                        },
                        totalDiscountsSet: {
                          shopMoney: {
                            amount: "4.00",
                            currencyCode: "USD",
                          },
                        },
                        totalTaxSet: {
                          shopMoney: {
                            amount: "1.50",
                            currencyCode: "USD",
                          },
                        },
                        totalShippingPriceSet: {
                          shopMoney: {
                            amount: "5.00",
                            currencyCode: "USD",
                          },
                        },
                        lineItems: {
                          nodes: [
                            {
                              id: "gid://shopify/LineItem/9301",
                              name: "Profit Guard Tee",
                              variantTitle: "Black / M",
                              sku: "PG-TEE-001",
                              quantity: 1,
                              variant: {
                                id: "gid://shopify/ProductVariant/9101",
                              },
                              originalTotalSet: {
                                shopMoney: {
                                  amount: "29.00",
                                  currencyCode: "USD",
                                },
                              },
                              discountedTotalSet: {
                                shopMoney: {
                                  amount: "25.00",
                                  currencyCode: "USD",
                                },
                              },
                              discountAllocations: [
                                {
                                  allocatedAmountSet: {
                                    shopMoney: {
                                      amount: "4.00",
                                      currencyCode: "USD",
                                    },
                                  },
                                },
                              ],
                              taxLines: [
                                {
                                  title: "Sales tax",
                                  rate: 0.06,
                                  priceSet: {
                                    shopMoney: {
                                      amount: "1.50",
                                      currencyCode: "USD",
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        shippingLines: {
                          nodes: [
                            {
                              code: "STANDARD",
                              title: "Standard shipping",
                              discountedPriceSet: {
                                shopMoney: {
                                  amount: "5.00",
                                  currencyCode: "USD",
                                },
                              },
                            },
                          ],
                        },
                        refunds: [],
                        transactions: [
                          {
                            id: "gid://shopify/OrderTransaction/9401",
                            kind: "SALE",
                            gateway: "shopify_payments",
                            status: "SUCCESS",
                            amountSet: {
                              shopMoney: {
                                amount: "30.50",
                                currencyCode: "USD",
                              },
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              }),
              {
                headers: {
                  "Content-Type": "application/json",
                },
              },
            );
          }

          throw new Error(`Unsupported smoke GraphQL query: ${query.slice(0, 80)}`);
        },
      },
    }) as Awaited<ReturnType<typeof unauthenticated.admin>>;

  let createdShopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName: "Profit Guard Smoke Shop",
        currencyCode: "USD",
        ianaTimezone: "UTC",
        backfillStatus: "NOT_STARTED",
      },
    });
    createdShopId = shop.id;

    await prisma.transactionFeeProfile.create({
      data: {
        shopId: shop.id,
        percentageRate: "0.0290",
        fixedFeeAmount: "0.3000",
        currencyCode: "USD",
        isDefault: true,
      },
    });

    await prisma.categoryCostProfile.createMany({
      data: [
        {
          shopId: shop.id,
          categoryKey: "product_type::Apparel",
          defaultCostRate: "0.3500",
          notes: "Smoke product type fallback",
        },
        {
          shopId: shop.id,
          categoryKey: "vendor::Profit Guard",
          defaultCostRate: "0.5000",
          notes: "Smoke vendor fallback",
        },
        {
          shopId: shop.id,
          categoryKey: "tag::smoke",
          defaultCostRate: "0.6000",
          notes: "Smoke tag fallback",
        },
      ],
    });

    await prisma.syncRun.create({
      data: {
        shopId: shop.id,
        runType: "SHOP_BOOTSTRAP",
        status: "QUEUED",
        metadata: {
          trigger: "smoke_test",
        },
      },
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const processed = await processNextSyncRun();

      if (!processed) {
        break;
      }
    }

    const [product, variant, order, orderLineItems, dailyMetric, healthScore, completenessSnapshot, syncRuns, updatedShop] =
      await Promise.all([
        prisma.product.findFirst({
          where: {
            shopId: shop.id,
          },
          select: {
            title: true,
            handle: true,
          },
        }),
        prisma.variant.findFirst({
          where: {
            shopId: shop.id,
          },
          select: {
            sku: true,
            priceAmount: true,
            inventoryQuantity: true,
          },
        }),
        prisma.order.findFirst({
          where: {
            shopId: shop.id,
          },
          select: {
            orderName: true,
            subtotalAmount: true,
            totalDiscountAmount: true,
            grossProfitBeforeAdSpend: true,
            dataCompletenessLevel: true,
          },
        }),
        prisma.orderLineItem.findMany({
          where: {
            order: {
              shopId: shop.id,
            },
          },
          select: {
            sku: true,
            subtotalAmount: true,
            discountAmount: true,
            productCostAmount: true,
            grossProfitAmount: true,
          },
        }),
        prisma.dailyShopMetric.findFirst({
          where: {
            shopId: shop.id,
          },
          orderBy: {
            metricDate: "desc",
          },
          select: {
            metricDate: true,
            ordersCount: true,
            grossSalesAmount: true,
            grossProfitBeforeAdSpend: true,
            grossMarginRate: true,
            completenessLevel: true,
          },
        }),
        prisma.profitHealthScore.findFirst({
          where: {
            shopId: shop.id,
          },
          orderBy: {
            scoreDate: "desc",
          },
          select: {
            scoreDate: true,
            score: true,
            levelLabel: true,
          },
        }),
        prisma.dataCompletenessSnapshot.findFirst({
          where: {
            shopId: shop.id,
          },
          orderBy: {
            snapshotDate: "desc",
          },
          select: {
            snapshotDate: true,
            level: true,
            variantCoverageRate: true,
            orderCoverageRate: true,
          },
        }),
        prisma.syncRun.findMany({
          where: {
            shopId: shop.id,
          },
          orderBy: {
            createdAt: "asc",
          },
          select: {
            runType: true,
            status: true,
          },
        }),
        prisma.shop.findUnique({
          where: {
            id: shop.id,
          },
          select: {
            backfillStatus: true,
            lastSyncedAt: true,
          },
        }),
      ]);

    assertCondition(product, "Smoke product was not created");
    assertCondition(variant, "Smoke variant was not created");
    assertCondition(order, "Smoke order was not created");
    assertCondition(orderLineItems.length > 0, "Smoke order line items were not created");
    assertCondition(dailyMetric, "Daily shop metric was not created");
    assertCondition(healthScore, "Health score was not created");
    assertCondition(completenessSnapshot, "Completeness snapshot was not created");
    assertCondition(updatedShop?.backfillStatus === "COMPLETED", "Shop backfill did not reach COMPLETED");
    assertCondition(syncRuns.every((run) => run.status === "SUCCEEDED"), "Not all sync runs succeeded");
    assertCondition(
      orderLineItems.some((lineItem) => lineItem.productCostAmount?.toString() === "8.75"),
      "Fallback priority did not produce the expected product cost",
    );

    console.info(
      JSON.stringify(
        {
          product: {
            title: product.title,
            handle: product.handle,
          },
          variant: {
            sku: variant.sku,
            priceAmount: variant.priceAmount?.toString() ?? null,
            inventoryQuantity: variant.inventoryQuantity,
          },
          order: {
            orderName: order.orderName,
            subtotalAmount: order.subtotalAmount?.toString() ?? null,
            totalDiscountAmount: order.totalDiscountAmount?.toString() ?? null,
            grossProfitBeforeAdSpend: order.grossProfitBeforeAdSpend?.toString() ?? null,
            dataCompletenessLevel: order.dataCompletenessLevel,
          },
          orderLineItems: orderLineItems.map((lineItem) => ({
            sku: lineItem.sku,
            subtotalAmount: lineItem.subtotalAmount?.toString() ?? null,
            discountAmount: lineItem.discountAmount?.toString() ?? null,
            productCostAmount: lineItem.productCostAmount?.toString() ?? null,
            grossProfitAmount: lineItem.grossProfitAmount?.toString() ?? null,
          })),
          dailyMetric: {
            metricDate: dailyMetric.metricDate.toISOString(),
            ordersCount: dailyMetric.ordersCount,
            grossSalesAmount: dailyMetric.grossSalesAmount.toString(),
            grossProfitBeforeAdSpend: dailyMetric.grossProfitBeforeAdSpend.toString(),
            grossMarginRate: dailyMetric.grossMarginRate?.toString() ?? null,
            completenessLevel: dailyMetric.completenessLevel,
          },
          healthScore: {
            scoreDate: healthScore.scoreDate.toISOString(),
            score: healthScore.score,
            levelLabel: healthScore.levelLabel,
          },
          completenessSnapshot: {
            snapshotDate: completenessSnapshot.snapshotDate.toISOString(),
            level: completenessSnapshot.level,
            variantCoverageRate: completenessSnapshot.variantCoverageRate?.toString() ?? null,
            orderCoverageRate: completenessSnapshot.orderCoverageRate?.toString() ?? null,
          },
          syncRuns,
          shop: {
            backfillStatus: updatedShop?.backfillStatus ?? null,
            lastSyncedAt: updatedShop?.lastSyncedAt?.toISOString() ?? null,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    unauthenticated.admin = originalAdmin;

    if (createdShopId) {
      await prisma.shop.delete({
        where: {
          id: createdShopId,
        },
      });
    }

    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Backfill pipeline failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
