import { Prisma } from "@prisma/client";
import db from "../db.server";
import { createLogger } from "./logger.server";

const complianceLogger = createLogger("compliance");

type CustomerReference = {
  email?: string | null;
  id?: string | number | null;
  phone?: string | null;
};

export type CustomersDataRequestPayload = {
  customer?: CustomerReference | null;
  data_request?: {
    id?: string | number | null;
  } | null;
  orders_requested?: Array<string | number> | null;
  shop_domain?: string | null;
  shop_id?: string | number | null;
};

export type CustomersRedactPayload = {
  customer?: CustomerReference | null;
  orders_to_redact?: Array<string | number> | null;
  shop_domain?: string | null;
  shop_id?: string | number | null;
};

export type ShopRedactPayload = {
  shop_domain?: string | null;
  shop_id?: string | number | null;
};

type ProcessComplianceWebhookArgs = {
  apiVersion?: string;
  payload: unknown;
  shopDomain: string;
  topic: string;
  webhookId: string;
};

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalIdentifier(value: unknown) {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  return normalizeOptionalString(value);
}

function extractCustomerReference(payload: { customer?: CustomerReference | null } | null | undefined) {
  return {
    customerEmail: normalizeOptionalString(payload?.customer?.email),
    customerPhone: normalizeOptionalString(payload?.customer?.phone),
    customerShopifyId: normalizeOptionalIdentifier(payload?.customer?.id),
  };
}

export function normalizeComplianceOrderIdentifiers(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }

  const identifiers = values
    .map((value) => normalizeOptionalIdentifier(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(identifiers));
}

export function buildShopifyOrderIdCandidates(orderIdentifier: string) {
  const normalized = normalizeOptionalIdentifier(orderIdentifier);
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);
  const gidMatch = normalized.match(/gid:\/\/shopify\/Order\/(\d+)$/);
  const trailingDigitsMatch = normalized.match(/(\d+)$/);
  const numericId = gidMatch?.[1] ?? trailingDigitsMatch?.[1] ?? null;

  if (numericId) {
    candidates.add(numericId);
    candidates.add(`gid://shopify/Order/${numericId}`);
  }

  return Array.from(candidates);
}

function buildRedactedPayload(entityType: string, references?: Record<string, unknown>) {
  return toJsonValue({
    entityType,
    redacted: true,
    redactedAt: new Date().toISOString(),
    ...references,
  });
}

async function createComplianceRequestRecord(args: {
  apiVersion?: string;
  payload: unknown;
  shopDomain: string;
  topic: string;
  webhookId: string;
}) {
  const payloadRecord = (args.payload ?? {}) as Record<string, unknown>;
  const shop = await db.shop.findUnique({
    where: {
      shopDomain: args.shopDomain,
    },
    select: {
      id: true,
      shopifyShopId: true,
    },
  });

  return db.complianceRequest.upsert({
    where: {
      topic_webhookId: {
        topic: args.topic,
        webhookId: args.webhookId,
      },
    },
    create: {
      apiVersion: args.apiVersion,
      customerEmail: extractCustomerReference(payloadRecord).customerEmail,
      customerPhone: extractCustomerReference(payloadRecord).customerPhone,
      customerShopifyId: extractCustomerReference(payloadRecord).customerShopifyId,
      orderIdentifiers: toJsonValue(
        normalizeComplianceOrderIdentifiers(
          payloadRecord.orders_requested ?? payloadRecord.orders_to_redact,
        ),
      ),
      payload: toJsonValue(args.payload),
      requestIdentifier: normalizeOptionalIdentifier(
        (payloadRecord.data_request as { id?: string | number | null } | null | undefined)?.id,
      ),
      shopDomain: args.shopDomain,
      shopId: shop?.id,
      shopifyShopId:
        normalizeOptionalIdentifier(payloadRecord.shop_id) ?? shop?.shopifyShopId ?? null,
      topic: args.topic,
      webhookId: args.webhookId,
    },
    update: {
      apiVersion: args.apiVersion,
      customerEmail: extractCustomerReference(payloadRecord).customerEmail,
      customerPhone: extractCustomerReference(payloadRecord).customerPhone,
      customerShopifyId: extractCustomerReference(payloadRecord).customerShopifyId,
      errorMessage: null,
      orderIdentifiers: toJsonValue(
        normalizeComplianceOrderIdentifiers(
          payloadRecord.orders_requested ?? payloadRecord.orders_to_redact,
        ),
      ),
      payload: toJsonValue(args.payload),
      requestIdentifier: normalizeOptionalIdentifier(
        (payloadRecord.data_request as { id?: string | number | null } | null | undefined)?.id,
      ),
      shopDomain: args.shopDomain,
      shopId: shop?.id,
      shopifyShopId:
        normalizeOptionalIdentifier(payloadRecord.shop_id) ?? shop?.shopifyShopId ?? null,
      status: "RECEIVED",
    },
  });
}

async function completeComplianceRequestRecord(
  complianceRequestId: string,
  resultPayload: unknown,
) {
  return db.complianceRequest.update({
    where: {
      id: complianceRequestId,
    },
    data: {
      completedAt: new Date(),
      errorMessage: null,
      resultPayload: toJsonValue(resultPayload),
      status: "COMPLETED",
    },
  });
}

async function failComplianceRequestRecord(
  complianceRequestId: string,
  error: unknown,
) {
  return db.complianceRequest.update({
    where: {
      id: complianceRequestId,
    },
    data: {
      errorMessage: error instanceof Error ? error.message : String(error),
      status: "FAILED",
    },
  });
}

async function loadOrdersForCompliance(shopId: string, orderIdentifiers: string[]) {
  if (orderIdentifiers.length === 0) {
    return [];
  }

  const orderIdCandidates = Array.from(
    new Set(orderIdentifiers.flatMap((orderIdentifier) => buildShopifyOrderIdCandidates(orderIdentifier))),
  );

  return db.order.findMany({
    where: {
      shopId,
      shopifyOrderId: {
        in: orderIdCandidates,
      },
    },
    orderBy: {
      processedAt: "desc",
    },
    select: {
      currencyCode: true,
      customerCountryCode: true,
      grossProfitBeforeAdSpend: true,
      id: true,
      orderCreatedAtShopify: true,
      orderName: true,
      presentmentCurrencyCode: true,
      processedAt: true,
      rawPayload: true,
      refunds: {
        select: {
          id: true,
          rawPayload: true,
          refundedAt: true,
          shopifyRefundId: true,
          totalRefundAmount: true,
        },
      },
      shopifyOrderId: true,
      sourceName: true,
      subtotalAmount: true,
      totalDiscountAmount: true,
      totalRefundAmount: true,
      totalShippingRevenueAmount: true,
      totalTaxAmount: true,
    },
  });
}

async function buildDataRequestResult(args: {
  orderIdentifiers: string[];
  payload: CustomersDataRequestPayload;
  shopDomain: string;
}) {
  const shop = await db.shop.findUnique({
    where: {
      shopDomain: args.shopDomain,
    },
    select: {
      currencyCode: true,
      id: true,
      isActive: true,
      shopDomain: true,
      shopName: true,
    },
  });

  if (!shop) {
    return {
      availableExport: false,
      matchedOrderCount: 0,
      note: "Shop record was not found locally. No customer-scoped export could be prepared.",
      requestedOrderReferences: args.orderIdentifiers,
      shopDomain: args.shopDomain,
    };
  }

  const orders = await loadOrdersForCompliance(shop.id, args.orderIdentifiers);
  const matchedRefundCount = orders.reduce((sum, order) => sum + order.refunds.length, 0);

  return {
    availableExport: true,
    currencyCode: shop.currencyCode ?? "USD",
    customerReference: {
      email: normalizeOptionalString(args.payload.customer?.email),
      id: normalizeOptionalIdentifier(args.payload.customer?.id),
      phone: normalizeOptionalString(args.payload.customer?.phone),
    },
    matchedOrderCount: orders.length,
    matchedRefundCount,
    note:
      orders.length > 0
        ? "Profit Guard matched order-level records for this request. Support can fulfill the request from these order references plus the portable data package."
        : "No order rows matched the requested order references. Profit Guard does not persist standalone customer profiles outside Shopify orders.",
    orders: orders.map((order) => ({
      currencyCode: order.currencyCode,
      customerCountryCode: order.customerCountryCode,
      grossProfitBeforeAdSpend: order.grossProfitBeforeAdSpend?.toString() ?? null,
      hasRawPayload: order.rawPayload != null,
      orderCreatedAtShopify: order.orderCreatedAtShopify?.toISOString() ?? null,
      orderName: order.orderName,
      presentmentCurrencyCode: order.presentmentCurrencyCode,
      processedAt: order.processedAt?.toISOString() ?? null,
      refundCount: order.refunds.length,
      shopifyOrderId: order.shopifyOrderId,
      sourceName: order.sourceName,
      subtotalAmount: order.subtotalAmount?.toString() ?? null,
      totalDiscountAmount: order.totalDiscountAmount?.toString() ?? null,
      totalRefundAmount: order.totalRefundAmount?.toString() ?? null,
      totalShippingRevenueAmount: order.totalShippingRevenueAmount?.toString() ?? null,
      totalTaxAmount: order.totalTaxAmount?.toString() ?? null,
    })),
    portableBundleRecommended: true,
    requestIdentifier: normalizeOptionalIdentifier(args.payload.data_request?.id),
    requestedOrderReferences: args.orderIdentifiers,
    shop: {
      isActive: shop.isActive,
      shopDomain: shop.shopDomain,
      shopName: shop.shopName ?? shop.shopDomain,
    },
  };
}

async function redactCustomerData(args: {
  orderIdentifiers: string[];
  payload: CustomersRedactPayload;
  shopDomain: string;
}) {
  const shop = await db.shop.findUnique({
    where: {
      shopDomain: args.shopDomain,
    },
    select: {
      id: true,
      shopDomain: true,
    },
  });

  if (!shop) {
    return {
      matchedOrderCount: 0,
      note: "Shop record was not found locally, so there was no customer data to redact.",
      requestedOrderReferences: args.orderIdentifiers,
      shopDomain: args.shopDomain,
    };
  }

  const orders = await loadOrdersForCompliance(shop.id, args.orderIdentifiers);
  if (orders.length === 0) {
    return {
      matchedOrderCount: 0,
      note:
        "No order rows matched the requested order references. Profit Guard does not store standalone customer profiles, so there was nothing additional to redact.",
      requestedOrderReferences: args.orderIdentifiers,
      shopDomain: shop.shopDomain,
    };
  }

  const orderIds = orders.map((order) => order.id);
  const refundIds = orders.flatMap((order) => order.refunds.map((refund) => refund.id));
  const redactedAt = new Date().toISOString();

  const result = await db.$transaction(async (tx) => {
    const [ordersResult, lineItemsResult, shippingLinesResult, discountsResult, taxLinesResult, transactionsResult, refundsResult, refundLineItemsResult] =
      await Promise.all([
        tx.order.updateMany({
          where: {
            id: {
              in: orderIds,
            },
          },
          data: {
            customerCountryCode: null,
            rawPayload: buildRedactedPayload("ORDER", {
              redactedAt,
            }),
          },
        }),
        tx.orderLineItem.updateMany({
          where: {
            orderId: {
              in: orderIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("ORDER_LINE_ITEM", {
              redactedAt,
            }),
          },
        }),
        tx.orderShippingLine.updateMany({
          where: {
            orderId: {
              in: orderIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("ORDER_SHIPPING_LINE", {
              redactedAt,
            }),
          },
        }),
        tx.orderDiscount.updateMany({
          where: {
            orderId: {
              in: orderIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("ORDER_DISCOUNT", {
              redactedAt,
            }),
          },
        }),
        tx.orderTaxLine.updateMany({
          where: {
            orderId: {
              in: orderIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("ORDER_TAX_LINE", {
              redactedAt,
            }),
          },
        }),
        tx.orderTransactionRaw.updateMany({
          where: {
            orderId: {
              in: orderIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("ORDER_TRANSACTION", {
              redactedAt,
            }),
          },
        }),
        tx.refund.updateMany({
          where: {
            id: {
              in: refundIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("REFUND", {
              redactedAt,
            }),
          },
        }),
        tx.refundLineItem.updateMany({
          where: {
            refundId: {
              in: refundIds,
            },
          },
          data: {
            rawPayload: buildRedactedPayload("REFUND_LINE_ITEM", {
              redactedAt,
            }),
          },
        }),
      ]);

    return {
      lineItemsRedacted: lineItemsResult.count,
      matchedOrderCount: ordersResult.count,
      refundsRedacted: refundsResult.count,
      refundLineItemsRedacted: refundLineItemsResult.count,
      shippingLinesRedacted: shippingLinesResult.count,
      taxLinesRedacted: taxLinesResult.count,
      discountsRedacted: discountsResult.count,
      transactionsRedacted: transactionsResult.count,
    };
  });

  return {
    customerReference: {
      email: normalizeOptionalString(args.payload.customer?.email),
      id: normalizeOptionalIdentifier(args.payload.customer?.id),
      phone: normalizeOptionalString(args.payload.customer?.phone),
    },
    ...result,
    note:
      "Customer-linked raw order payloads were replaced with redacted markers while keeping financial aggregates required for merchant reporting.",
    requestedOrderReferences: args.orderIdentifiers,
    shopDomain: shop.shopDomain,
  };
}

async function eraseShopData(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      id: true,
      shopDomain: true,
    },
  });

  const sessionDeleteResult = await db.session.deleteMany({
    where: {
      shop: shopDomain,
    },
  });

  if (!shop) {
    return {
      note: "Shop record was already absent locally. Session cleanup still ran.",
      sessionsDeleted: sessionDeleteResult.count,
      shopDeleted: false,
      shopDomain,
    };
  }

  const [
    orderCount,
    refundCount,
    alertCount,
    reportCount,
    digestDeliveryCount,
    webhookEventCount,
    complianceRequestCount,
  ] = await Promise.all([
    db.order.count({ where: { shopId: shop.id } }),
    db.refund.count({ where: { shopId: shop.id } }),
    db.alert.count({ where: { shopId: shop.id } }),
    db.reportSnapshot.count({ where: { shopId: shop.id } }),
    db.digestDelivery.count({ where: { shopId: shop.id } }),
    db.webhookEvent.count({ where: { shopId: shop.id } }),
    db.complianceRequest.count({ where: { shopId: shop.id } }),
  ]);

  await db.shop.delete({
    where: {
      id: shop.id,
    },
  });

  return {
    alertsDeleted: alertCount,
    complianceRequestsDetached: complianceRequestCount,
    digestDeliveriesDeleted: digestDeliveryCount,
    note: "Shop row was deleted and all cascade-owned Profit Guard records were erased.",
    ordersDeleted: orderCount,
    refundsDeleted: refundCount,
    reportSnapshotsDeleted: reportCount,
    sessionsDeleted: sessionDeleteResult.count,
    shopDeleted: true,
    shopDomain: shop.shopDomain,
    webhookEventsDetached: webhookEventCount,
  };
}

export async function processComplianceWebhook(args: ProcessComplianceWebhookArgs) {
  const complianceRequest = await createComplianceRequestRecord(args);

  try {
    let resultPayload: Record<string, unknown>;

    if (args.topic === "customers/data_request") {
      const payload = (args.payload ?? {}) as CustomersDataRequestPayload;
      const orderIdentifiers = normalizeComplianceOrderIdentifiers(payload.orders_requested);
      resultPayload = await buildDataRequestResult({
        orderIdentifiers,
        payload,
        shopDomain: args.shopDomain,
      });
    } else if (args.topic === "customers/redact") {
      const payload = (args.payload ?? {}) as CustomersRedactPayload;
      const orderIdentifiers = normalizeComplianceOrderIdentifiers(payload.orders_to_redact);
      resultPayload = await redactCustomerData({
        orderIdentifiers,
        payload,
        shopDomain: args.shopDomain,
      });
    } else if (args.topic === "shop/redact") {
      resultPayload = await eraseShopData(args.shopDomain);
    } else {
      throw new Error(`Unsupported compliance webhook topic: ${args.topic}`);
    }

    await completeComplianceRequestRecord(complianceRequest.id, resultPayload);
    complianceLogger.info("webhook_processed", {
      complianceRequestId: complianceRequest.id,
      shopDomain: args.shopDomain,
      topic: args.topic,
    });

    return resultPayload;
  } catch (error) {
    await failComplianceRequestRecord(complianceRequest.id, error);
    complianceLogger.error("webhook_failed", {
      complianceRequestId: complianceRequest.id,
      error: error instanceof Error ? error.message : String(error),
      shopDomain: args.shopDomain,
      topic: args.topic,
    });
    throw error;
  }
}
