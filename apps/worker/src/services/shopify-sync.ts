import prisma from "../../../../packages/db/src/client";
import { unauthenticated } from "../../../web/app/shopify.server";
import {
  resolveLineItemCost,
  type CategoryCostCandidate,
  type CostCandidate,
  type SupplierContractCandidate,
} from "./cost-resolution";

const PRODUCTS_PAGE_SIZE = 25;
const ORDERS_PAGE_SIZE = 25;

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type MoneyBag = {
  shopMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
} | null;

type ProductVariantNode = {
  id: string;
  sku?: string | null;
  title?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  inventoryQuantity?: number | null;
  inventoryItem?: {
    measurement?: {
      weight?: {
        value?: number | null;
        unit?: string | null;
      } | null;
    } | null;
  } | null;
};

type ProductNode = {
  id: string;
  title: string;
  handle?: string | null;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  variants?: {
    nodes?: ProductVariantNode[] | null;
  } | null;
};

type ProductsQueryPayload = {
  products?: {
    nodes?: ProductNode[] | null;
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    } | null;
  } | null;
};

type OrderLineItemNode = {
  id: string;
  name?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  quantity?: number | null;
  variant?: {
    id?: string | null;
  } | null;
  originalTotalSet?: MoneyBag;
  discountedTotalSet?: MoneyBag;
  discountAllocations?: Array<{
    allocatedAmountSet?: MoneyBag;
  }> | null;
  taxLines?: Array<{
    title?: string | null;
    rate?: number | null;
    priceSet?: MoneyBag;
  }> | null;
};

type OrderRefundLineItemNode = {
  quantity?: number | null;
  lineItem?: {
    id?: string | null;
  } | null;
  subtotalSet?: MoneyBag;
  totalTaxSet?: MoneyBag;
};

type OrderRefundNode = {
  id: string;
  createdAt?: string | null;
  totalRefundedSet?: MoneyBag;
  refundLineItems?: {
    nodes?: OrderRefundLineItemNode[] | null;
  } | null;
};

type OrderShippingLineNode = {
  code?: string | null;
  title?: string | null;
  discountedPriceSet?: MoneyBag;
};

type OrderTransactionNode = {
  id?: string | null;
  kind?: string | null;
  gateway?: string | null;
  status?: string | null;
  amountSet?: MoneyBag;
};

type OrderNode = {
  id: string;
  name?: string | null;
  processedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  currencyCode?: string | null;
  sourceName?: string | null;
  test?: boolean | null;
  shippingAddress?: {
    countryCodeV2?: string | null;
  } | null;
  subtotalPriceSet?: MoneyBag;
  totalDiscountsSet?: MoneyBag;
  totalTaxSet?: MoneyBag;
  totalShippingPriceSet?: MoneyBag;
  lineItems?: {
    nodes?: OrderLineItemNode[] | null;
  } | null;
  shippingLines?: {
    nodes?: OrderShippingLineNode[] | null;
  } | null;
  refunds?: Array<OrderRefundNode> | null;
  transactions?: Array<OrderTransactionNode> | null;
};

type OrdersQueryPayload = {
  orders?: {
    nodes?: OrderNode[] | null;
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    } | null;
  } | null;
};

type SyncSummary = {
  recordsSynced: number;
  recordsTotal: number;
  metadata: Record<string, unknown>;
};

const PRODUCTS_QUERY = `#graphql
  query ProfitGuardBackfillProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        tags
        createdAt
        updatedAt
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            compareAtPrice
            inventoryQuantity
            inventoryItem {
              measurement {
                weight {
                  value
                  unit
                }
              }
            }
          }
        }
      }
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query ProfitGuardBackfillOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true, query: "status:any") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        name
        processedAt
        createdAt
        updatedAt
        currencyCode
        sourceName
        test
        shippingAddress {
          countryCodeV2
        }
        subtotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalDiscountsSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalTaxSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 100) {
          nodes {
            id
            name
            variantTitle
            sku
            quantity
            variant {
              id
            }
            originalTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountedTotalSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            discountAllocations {
              allocatedAmountSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
            taxLines {
              title
              rate
              priceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
        shippingLines(first: 20) {
          nodes {
            code
            title
            discountedPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
        refunds {
          id
          createdAt
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          refundLineItems(first: 50) {
            nodes {
              quantity
              lineItem {
                id
              }
              subtotalSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
        transactions {
          id
          kind
          gateway
          status
          amountSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function moneyBagToNumber(moneyBag?: MoneyBag) {
  const rawAmount = moneyBag?.shopMoney?.amount;
  const value = rawAmount ? Number(rawAmount) : 0;
  return Number.isFinite(value) ? value : 0;
}

function moneyBagToCurrency(moneyBag?: MoneyBag, fallback = "USD") {
  return moneyBag?.shopMoney?.currencyCode || fallback;
}

function decimalString(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return value.toFixed(digits);
}

function parseDate(value?: string | null) {
  return value ? new Date(value) : null;
}

async function readGraphqlData<T>(
  shopDomain: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const { admin } = await unauthenticated.admin(shopDomain);
  const response = await admin.graphql(query, { variables });
  const result = (await response.json()) as GraphqlResponse<T>;

  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }

  if (!result.data) {
    throw new Error("Shopify Admin API returned an empty payload");
  }

  return result.data;
}

async function upsertProduct(shopId: string, product: ProductNode) {
  const productRecord = await prisma.product.upsert({
    where: {
      shopId_shopifyProductId: {
        shopId,
        shopifyProductId: product.id,
      },
    },
    update: {
      title: product.title,
      handle: product.handle ?? null,
      vendor: product.vendor ?? null,
      productType: product.productType ?? null,
      status: product.status ?? null,
      tags: toJsonValue(product.tags ?? []),
      createdAtShopify: parseDate(product.createdAt),
      updatedAtShopify: parseDate(product.updatedAt),
      rawPayload: toJsonValue(product),
    },
    create: {
      shopId,
      shopifyProductId: product.id,
      title: product.title,
      handle: product.handle ?? null,
      vendor: product.vendor ?? null,
      productType: product.productType ?? null,
      status: product.status ?? null,
      tags: toJsonValue(product.tags ?? []),
      createdAtShopify: parseDate(product.createdAt),
      updatedAtShopify: parseDate(product.updatedAt),
      rawPayload: toJsonValue(product),
    },
  });

  const variants = product.variants?.nodes ?? [];
  for (const variant of variants) {
    await prisma.variant.upsert({
      where: {
        shopId_shopifyVariantId: {
          shopId,
          shopifyVariantId: variant.id,
        },
      },
      update: {
        productId: productRecord.id,
        sku: variant.sku ?? null,
        title: variant.title ?? null,
        priceAmount: variant.price ?? null,
        compareAtAmount: variant.compareAtPrice ?? null,
        inventoryQuantity: variant.inventoryQuantity ?? null,
        weightValue:
          variant.inventoryItem?.measurement?.weight?.value != null
            ? variant.inventoryItem.measurement.weight.value.toString()
            : null,
        weightUnit: variant.inventoryItem?.measurement?.weight?.unit ?? null,
        rawPayload: toJsonValue(variant),
      },
      create: {
        shopId,
        productId: productRecord.id,
        shopifyVariantId: variant.id,
        sku: variant.sku ?? null,
        title: variant.title ?? null,
        priceAmount: variant.price ?? null,
        compareAtAmount: variant.compareAtPrice ?? null,
        inventoryQuantity: variant.inventoryQuantity ?? null,
        weightValue:
          variant.inventoryItem?.measurement?.weight?.value != null
            ? variant.inventoryItem.measurement.weight.value.toString()
            : null,
        weightUnit: variant.inventoryItem?.measurement?.weight?.unit ?? null,
        rawPayload: toJsonValue(variant),
      },
    });
  }

  return {
    productsSynced: 1,
    variantsSynced: variants.length,
  };
}

type VariantLookup = {
  id: string;
  shopifyVariantId: string;
  sku: string | null;
  productType: string | null;
  tags: string[];
  vendor: string | null;
};

async function loadVariantLookup(shopId: string, variantShopifyIds: string[]) {
  if (variantShopifyIds.length === 0) {
    return new Map<string, VariantLookup>();
  }

  const variants = await prisma.variant.findMany({
    where: {
      shopId,
      shopifyVariantId: {
        in: variantShopifyIds,
      },
    },
    select: {
      id: true,
      shopifyVariantId: true,
      sku: true,
      product: {
        select: {
          productType: true,
          tags: true,
          vendor: true,
        },
      },
    },
  });

  return new Map(
    variants.map((variant) => [
      variant.shopifyVariantId,
      {
        id: variant.id,
        shopifyVariantId: variant.shopifyVariantId,
        sku: variant.sku,
        productType: variant.product.productType,
        tags: Array.isArray(variant.product.tags) ? variant.product.tags.filter((tag): tag is string => typeof tag === "string") : [],
        vendor: variant.product.vendor,
      },
    ]),
  );
}

async function loadCostCandidates(params: {
  shopId: string;
  processedAt: Date;
  variantIds: string[];
  skus: string[];
}) {
  const { processedAt, shopId, skus, variantIds } = params;
  const keyFilters = [];

  if (variantIds.length > 0) {
    keyFilters.push({
      variantId: {
        in: variantIds,
      },
    });
  }

  if (skus.length > 0) {
    keyFilters.push({
      sku: {
        in: skus,
      },
    });
  }

  if (keyFilters.length === 0) {
    return [] as CostCandidate[];
  }

  const costs = await prisma.variantCost.findMany({
    where: {
      shopId,
      effectiveFrom: {
        lte: processedAt,
      },
      AND: [
        {
          OR: [
            {
              effectiveTo: null,
            },
            {
              effectiveTo: {
                gte: processedAt,
              },
            },
          ],
        },
        {
          OR: keyFilters,
        },
      ],
    },
    orderBy: {
      effectiveFrom: "desc",
    },
    select: {
      variantId: true,
      sku: true,
      costAmount: true,
    },
  });

  return costs.map((cost) => ({
    variantId: cost.variantId,
    sku: cost.sku,
    costAmount: cost.costAmount.toString(),
  }));
}

async function loadCategoryCostProfiles(shopId: string) {
  const profiles = await prisma.categoryCostProfile.findMany({
    where: {
      shopId,
    },
    select: {
      categoryKey: true,
      defaultCostRate: true,
    },
  });

  return profiles.map((profile) => ({
    categoryKey: profile.categoryKey,
    defaultCostRate: profile.defaultCostRate.toString(),
  })) satisfies CategoryCostCandidate[];
}

async function loadSupplierContractProfiles(shopId: string, processedAt: Date) {
  const profiles = await prisma.supplierContractProfile.findMany({
    where: {
      shopId,
      effectiveFrom: {
        lte: processedAt,
      },
      OR: [
        {
          effectiveTo: null,
        },
        {
          effectiveTo: {
            gte: processedAt,
          },
        },
      ],
    },
    orderBy: [
      {
        effectiveFrom: "desc",
      },
      {
        productType: "desc",
      },
    ],
    select: {
      vendorName: true,
      productType: true,
      unitCostAmount: true,
      currencyCode: true,
    },
  });

  return profiles.map((profile) => ({
    vendorName: profile.vendorName,
    productType: profile.productType,
    unitCostAmount: profile.unitCostAmount.toString(),
    currencyCode: profile.currencyCode,
  })) satisfies SupplierContractCandidate[];
}

async function loadDefaultTransactionFeeProfile(shopId: string) {
  return prisma.transactionFeeProfile.findFirst({
    where: {
      shopId,
      isDefault: true,
    },
    orderBy: {
      effectiveFrom: "desc",
    },
  });
}

function estimateTransactionFee(
  subtotalAmount: number,
  discountAmount: number,
  shippingRevenueAmount: number,
  profile: Awaited<ReturnType<typeof loadDefaultTransactionFeeProfile>>,
) {
  if (!profile) {
    return 0;
  }

  const percentageRate = Number(profile.percentageRate.toString());
  const fixedFeeAmount = Number(profile.fixedFeeAmount.toString());
  const chargeBase = Math.max(subtotalAmount - discountAmount + shippingRevenueAmount, 0);

  return roundMoney(chargeBase * percentageRate + fixedFeeAmount);
}

async function upsertOrder(shopId: string, order: OrderNode) {
  const processedAt = parseDate(order.processedAt) ?? parseDate(order.createdAt) ?? new Date();
  const lineItems = order.lineItems?.nodes ?? [];
  const refunds = order.refunds ?? [];
  const shippingLines = order.shippingLines?.nodes ?? [];
  const transactions = order.transactions ?? [];

  const variantLookup = await loadVariantLookup(
    shopId,
    lineItems
      .map((lineItem) => lineItem.variant?.id ?? null)
      .filter((value): value is string => Boolean(value)),
  );
  const costCandidates = await loadCostCandidates({
    shopId,
    processedAt,
    variantIds: [...new Set(Array.from(variantLookup.values()).map((variant) => variant.id))],
    skus: [...new Set(lineItems.map((lineItem) => lineItem.sku ?? null).filter((value): value is string => Boolean(value)))],
  });
  const [categoryProfiles, supplierContracts, feeProfile] = await Promise.all([
    loadCategoryCostProfiles(shopId),
    loadSupplierContractProfiles(shopId, processedAt),
    loadDefaultTransactionFeeProfile(shopId),
  ]);

  const subtotalAmount = roundMoney(moneyBagToNumber(order.subtotalPriceSet));
  const discountAmount = roundMoney(moneyBagToNumber(order.totalDiscountsSet));
  const taxAmount = roundMoney(moneyBagToNumber(order.totalTaxSet));
  const shippingRevenueAmount = roundMoney(moneyBagToNumber(order.totalShippingPriceSet));
  const currencyCode = order.currencyCode || moneyBagToCurrency(order.subtotalPriceSet, "USD");

  const refundAggregation = new Map<
    string,
    { subtotalAmount: number; taxAmount: number; quantity: number }
  >();
  let totalRefundAmount = 0;

  for (const refund of refunds) {
    totalRefundAmount += moneyBagToNumber(refund.totalRefundedSet);

    for (const refundLineItem of refund.refundLineItems?.nodes ?? []) {
      const lineItemId = refundLineItem.lineItem?.id;
      if (!lineItemId) {
        continue;
      }

      const current = refundAggregation.get(lineItemId) ?? {
        subtotalAmount: 0,
        taxAmount: 0,
        quantity: 0,
      };

      refundAggregation.set(lineItemId, {
        subtotalAmount: roundMoney(
          current.subtotalAmount + moneyBagToNumber(refundLineItem.subtotalSet),
        ),
        taxAmount: roundMoney(current.taxAmount + moneyBagToNumber(refundLineItem.totalTaxSet)),
        quantity: current.quantity + (refundLineItem.quantity ?? 0),
      });
    }
  }

  let totalProductCost = 0;
  let missingCostCount = 0;
  const orderLineItems = lineItems.map((lineItem) => {
    const localVariant = lineItem.variant?.id
      ? variantLookup.get(lineItem.variant.id) ?? null
      : null;
    const refundInfo = refundAggregation.get(lineItem.id) ?? {
      subtotalAmount: 0,
      taxAmount: 0,
      quantity: 0,
    };
    const lineSubtotal = roundMoney(moneyBagToNumber(lineItem.originalTotalSet));
    const lineDiscount = roundMoney(
      (lineItem.discountAllocations ?? []).reduce((sum, allocation) => {
        return sum + moneyBagToNumber(allocation.allocatedAmountSet);
      }, 0),
    );
    const lineTax = roundMoney(
      (lineItem.taxLines ?? []).reduce((sum, taxLine) => {
        return sum + moneyBagToNumber(taxLine.priceSet);
      }, 0),
    );
    const quantity = lineItem.quantity ?? 0;
    const resolvedProductCost = resolveLineItemCost({
      candidates: costCandidates,
      supplierContracts,
      categoryProfiles,
      localVariantId: localVariant?.id ?? null,
      sku: lineItem.sku ?? localVariant?.sku ?? null,
      productType: localVariant?.productType ?? null,
      tags: localVariant?.tags ?? [],
      vendor: localVariant?.vendor ?? null,
      quantity,
      lineSubtotalAmount: lineSubtotal,
      lineDiscountAmount: lineDiscount,
    });
    const productCost = resolvedProductCost?.amount ?? null;

    if (productCost == null && quantity > 0) {
      missingCostCount += 1;
    }

    totalProductCost += productCost ?? 0;

    const grossProfitAmount = roundMoney(
      lineSubtotal - lineDiscount - refundInfo.subtotalAmount - (productCost ?? 0),
    );

    return {
      shopifyLineItemId: lineItem.id,
      variantId: localVariant?.id ?? null,
      productTitle: lineItem.name ?? null,
      variantTitle: lineItem.variantTitle ?? null,
      sku: lineItem.sku ?? localVariant?.sku ?? null,
      quantity,
      subtotalAmount: lineSubtotal,
      discountAmount: lineDiscount,
      taxAmount: lineTax,
      refundedAmount: refundInfo.subtotalAmount,
      productCostAmount: productCost,
      grossProfitAmount,
      rawPayload: toJsonValue(lineItem),
      taxLines: (lineItem.taxLines ?? []).map((taxLine) => ({
        title: taxLine.title ?? null,
        rate: taxLine.rate ?? null,
        amount: moneyBagToNumber(taxLine.priceSet),
        rawPayload: toJsonValue(taxLine),
      })),
      discountRows: (lineItem.discountAllocations ?? []).map((allocation) => ({
        amount: moneyBagToNumber(allocation.allocatedAmountSet),
        rawPayload: toJsonValue(allocation),
      })),
    };
  });

  const shippingCostEstimate = 0;
  const transactionFeeEstimate = estimateTransactionFee(
    subtotalAmount,
    discountAmount,
    shippingRevenueAmount,
    feeProfile,
  );
  const grossProfitBeforeAdSpend = roundMoney(
    subtotalAmount -
      discountAmount -
      totalRefundAmount +
      shippingRevenueAmount -
      totalProductCost -
      shippingCostEstimate -
      transactionFeeEstimate,
  );
  const completenessLevel =
    lineItems.length > 0 && missingCostCount === 0 ? "MEDIUM" : "LOW";

  const orderRecord = await prisma.order.upsert({
    where: {
      shopId_shopifyOrderId: {
        shopId,
        shopifyOrderId: order.id,
      },
    },
    update: {
      orderName: order.name ?? null,
      processedAt,
      orderCreatedAtShopify: parseDate(order.createdAt),
      orderUpdatedAtShopify: parseDate(order.updatedAt),
      currencyCode,
      presentmentCurrencyCode: currencyCode,
      subtotalAmount: decimalString(subtotalAmount),
      totalDiscountAmount: decimalString(discountAmount),
      totalRefundAmount: decimalString(totalRefundAmount),
      totalTaxAmount: decimalString(taxAmount),
      totalShippingRevenueAmount: decimalString(shippingRevenueAmount),
      shippingCostEstimateAmount: decimalString(shippingCostEstimate),
      transactionFeeEstimateAmount: decimalString(transactionFeeEstimate),
      grossProfitBeforeAdSpend: decimalString(grossProfitBeforeAdSpend),
      salesChannel: order.sourceName ?? null,
      sourceName: order.sourceName ?? null,
      customerCountryCode: order.shippingAddress?.countryCodeV2 ?? null,
      dataCompletenessLevel: completenessLevel,
      isTest: order.test ?? false,
      rawPayload: toJsonValue(order),
    },
    create: {
      shopId,
      shopifyOrderId: order.id,
      orderName: order.name ?? null,
      processedAt,
      orderCreatedAtShopify: parseDate(order.createdAt),
      orderUpdatedAtShopify: parseDate(order.updatedAt),
      currencyCode,
      presentmentCurrencyCode: currencyCode,
      subtotalAmount: decimalString(subtotalAmount),
      totalDiscountAmount: decimalString(discountAmount),
      totalRefundAmount: decimalString(totalRefundAmount),
      totalTaxAmount: decimalString(taxAmount),
      totalShippingRevenueAmount: decimalString(shippingRevenueAmount),
      shippingCostEstimateAmount: decimalString(shippingCostEstimate),
      transactionFeeEstimateAmount: decimalString(transactionFeeEstimate),
      grossProfitBeforeAdSpend: decimalString(grossProfitBeforeAdSpend),
      salesChannel: order.sourceName ?? null,
      sourceName: order.sourceName ?? null,
      customerCountryCode: order.shippingAddress?.countryCodeV2 ?? null,
      dataCompletenessLevel: completenessLevel,
      isTest: order.test ?? false,
      rawPayload: toJsonValue(order),
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.refund.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });
    await tx.orderDiscount.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });
    await tx.orderTaxLine.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });
    await tx.orderShippingLine.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });
    await tx.orderTransactionRaw.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });
    await tx.orderLineItem.deleteMany({
      where: {
        orderId: orderRecord.id,
      },
    });

    const lineItemIdMap = new Map<string, string>();

    for (const lineItem of orderLineItems) {
      const createdLineItem = await tx.orderLineItem.create({
        data: {
          orderId: orderRecord.id,
          variantId: lineItem.variantId,
          shopifyLineItemId: lineItem.shopifyLineItemId,
          productTitle: lineItem.productTitle,
          variantTitle: lineItem.variantTitle,
          sku: lineItem.sku,
          quantity: lineItem.quantity,
          subtotalAmount: decimalString(lineItem.subtotalAmount),
          discountAmount: decimalString(lineItem.discountAmount),
          taxAmount: decimalString(lineItem.taxAmount),
          refundedAmount: decimalString(lineItem.refundedAmount),
          productCostAmount: decimalString(lineItem.productCostAmount),
          grossProfitAmount: decimalString(lineItem.grossProfitAmount),
          rawPayload: lineItem.rawPayload,
        },
      });

      lineItemIdMap.set(lineItem.shopifyLineItemId, createdLineItem.id);

      for (const taxLine of lineItem.taxLines) {
        await tx.orderTaxLine.create({
          data: {
            orderId: orderRecord.id,
            lineItemId: createdLineItem.id,
            title: taxLine.title,
            rate:
              taxLine.rate != null ? taxLine.rate.toFixed(5) : null,
            amount: decimalString(taxLine.amount),
            rawPayload: taxLine.rawPayload,
          },
        });
      }

      for (const discountRow of lineItem.discountRows) {
        await tx.orderDiscount.create({
          data: {
            orderId: orderRecord.id,
            lineItemId: createdLineItem.id,
            amount: decimalString(discountRow.amount),
            rawPayload: discountRow.rawPayload,
          },
        });
      }
    }

    for (const shippingLine of shippingLines) {
      await tx.orderShippingLine.create({
        data: {
          orderId: orderRecord.id,
          shippingCode: shippingLine.code ?? null,
          title: shippingLine.title ?? null,
          revenueAmount: decimalString(moneyBagToNumber(shippingLine.discountedPriceSet)),
          costEstimate: decimalString(0),
          rawPayload: toJsonValue(shippingLine),
        },
      });
    }

    for (const transaction of transactions) {
      await tx.orderTransactionRaw.create({
        data: {
          orderId: orderRecord.id,
          shopifyTransactionId: transaction.id ?? null,
          kind: transaction.kind ?? null,
          gateway: transaction.gateway ?? null,
          status: transaction.status ?? null,
          amount: decimalString(moneyBagToNumber(transaction.amountSet)),
          currencyCode: moneyBagToCurrency(transaction.amountSet, currencyCode),
          rawPayload: toJsonValue(transaction),
        },
      });
    }

    for (const refund of refunds) {
      const refundRecord = await tx.refund.create({
        data: {
          shopId,
          orderId: orderRecord.id,
          shopifyRefundId: refund.id,
          refundedAt: parseDate(refund.createdAt),
          totalRefundAmount: decimalString(moneyBagToNumber(refund.totalRefundedSet)),
          currencyCode: moneyBagToCurrency(refund.totalRefundedSet, currencyCode),
          rawPayload: toJsonValue(refund),
        },
      });

      for (const refundLineItem of refund.refundLineItems?.nodes ?? []) {
        await tx.refundLineItem.create({
          data: {
            refundId: refundRecord.id,
            orderLineItemId: refundLineItem.lineItem?.id
              ? lineItemIdMap.get(refundLineItem.lineItem.id) ?? null
              : null,
            shopifyRefundLineId: refundLineItem.lineItem?.id ?? null,
            quantity: refundLineItem.quantity ?? null,
            subtotalAmount: decimalString(moneyBagToNumber(refundLineItem.subtotalSet)),
            taxAmount: decimalString(moneyBagToNumber(refundLineItem.totalTaxSet)),
            rawPayload: toJsonValue(refundLineItem),
          },
        });
      }
    }
  });

  return {
    ordersSynced: 1,
    lineItemsSynced: orderLineItems.length,
    refundsSynced: refunds.length,
    transactionsSynced: transactions.length,
  };
}

export async function runProductBackfill(params: {
  shopId: string;
  shopDomain: string;
  runId: string;
}) {
  const { runId, shopDomain, shopId } = params;
  let cursor: string | null = null;
  let hasNextPage = true;
  let productsSynced = 0;
  let variantsSynced = 0;
  let pagesProcessed = 0;

  while (hasNextPage) {
    const data: ProductsQueryPayload = await readGraphqlData<ProductsQueryPayload>(
      shopDomain,
      PRODUCTS_QUERY,
      {
      first: PRODUCTS_PAGE_SIZE,
      after: cursor,
      },
    );
    const products = data.products?.nodes ?? [];

    for (const product of products) {
      const result = await upsertProduct(shopId, product);
      productsSynced += result.productsSynced;
      variantsSynced += result.variantsSynced;
    }

    pagesProcessed += 1;
    cursor = data.products?.pageInfo?.endCursor ?? null;
    hasNextPage = Boolean(data.products?.pageInfo?.hasNextPage);

    await prisma.syncRun.update({
      where: {
        id: runId,
      },
      data: {
        cursor,
        recordsSynced: productsSynced + variantsSynced,
      },
    });
  }

  return {
    recordsSynced: productsSynced + variantsSynced,
    recordsTotal: productsSynced + variantsSynced,
    metadata: {
      pagesProcessed,
      productsSynced,
      variantsSynced,
    },
  } satisfies SyncSummary;
}

export async function runOrderBackfill(params: {
  shopId: string;
  shopDomain: string;
  runId: string;
}) {
  const { runId, shopDomain, shopId } = params;
  let cursor: string | null = null;
  let hasNextPage = true;
  let ordersSynced = 0;
  let lineItemsSynced = 0;
  let refundsSynced = 0;
  let transactionsSynced = 0;
  let pagesProcessed = 0;

  while (hasNextPage) {
    const data: OrdersQueryPayload = await readGraphqlData<OrdersQueryPayload>(
      shopDomain,
      ORDERS_QUERY,
      {
      first: ORDERS_PAGE_SIZE,
      after: cursor,
      },
    );
    const orders = data.orders?.nodes ?? [];

    for (const order of orders) {
      const result = await upsertOrder(shopId, order);
      ordersSynced += result.ordersSynced;
      lineItemsSynced += result.lineItemsSynced;
      refundsSynced += result.refundsSynced;
      transactionsSynced += result.transactionsSynced;
    }

    pagesProcessed += 1;
    cursor = data.orders?.pageInfo?.endCursor ?? null;
    hasNextPage = Boolean(data.orders?.pageInfo?.hasNextPage);

    await prisma.syncRun.update({
      where: {
        id: runId,
      },
      data: {
        cursor,
        recordsSynced: ordersSynced + lineItemsSynced + refundsSynced + transactionsSynced,
      },
    });
  }

  return {
    recordsSynced: ordersSynced + lineItemsSynced + refundsSynced + transactionsSynced,
    recordsTotal: ordersSynced + lineItemsSynced + refundsSynced + transactionsSynced,
    metadata: {
      pagesProcessed,
      ordersSynced,
      lineItemsSynced,
      refundsSynced,
      transactionsSynced,
    },
  } satisfies SyncSummary;
}
