import { Form, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getProfitViewsOverview,
  resolveProfitRange,
} from "../services/profit-views.server";

const PROFIT_RANGE_VALUES = ["7d", "30d", "90d"] as const;

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value?: string | null, currencyCode = "USD") {
  if (!value) {
    return "Not available";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(numericValue);
}

function formatPercent(value?: number | string | null) {
  if (value == null) {
    return "Not available";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(numericValue);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = resolveProfitRange(url.searchParams.get("range"));
  const overview = await getProfitViewsOverview({
    range,
    shopDomain: session.shop,
  });

  return overview;
};

export default function ProfitViewsPage() {
  const data = useLoaderData<typeof loader>();

  if (!data) {
    return (
      <s-page heading="Profit Views">
        <s-section heading="Profit views">
          <s-paragraph>Shop record not found.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Profit Views">
      <s-section heading="Window">
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          {PROFIT_RANGE_VALUES.map((range) => (
            <Form key={range} method="get">
              <input type="hidden" name="range" value={range} />
              <button
                type="submit"
                style={{
                  appearance: "none",
                  border: "1px solid #111827",
                  borderRadius: "999px",
                  padding: "0.55rem 0.9rem",
                  background: data.range === range ? "#111827" : "#ffffff",
                  color: data.range === range ? "#ffffff" : "#111827",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {range.toUpperCase()}
              </button>
            </Form>
          ))}
          <div style={{ color: "#4b5563" }}>
            Shop: <strong>{data.shopName}</strong> · Latest metric: {formatDate(data.latestMetricDate)}
          </div>
        </div>
      </s-section>

      {data.totals ? (
        <>
          <s-section heading="Range totals">
            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Gross sales</strong>
                <div>{formatCurrency(data.totals.grossSalesAmount, data.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Gross profit</strong>
                <div>{formatCurrency(data.totals.grossProfitBeforeAdSpend, data.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Gross margin</strong>
                <div>{formatPercent(data.totals.grossMarginRate)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Refunds</strong>
                <div>{formatCurrency(data.totals.refundAmount, data.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Discounts</strong>
                <div>{formatCurrency(data.totals.discountAmount, data.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Orders</strong>
                <div>{data.totals.ordersCount}</div>
              </s-box>
            </div>
          </s-section>

          <s-section heading="Orders view">
            {data.orderRows.length > 0 ? (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {data.orderRows.map((order) => (
                  <s-box key={`${order.orderName}-${order.processedAt}`} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <strong>{order.orderName}</strong>
                    <div>{formatDate(order.processedAt)} · {order.salesChannel}</div>
                    <div>
                      Sales: {formatCurrency(order.subtotalAmount, order.currencyCode || data.currencyCode)}
                      {" · "}
                      Profit: {formatCurrency(order.grossProfitBeforeAdSpend, order.currencyCode || data.currencyCode)}
                    </div>
                    <div>
                      Refunds: {formatCurrency(order.totalRefundAmount, order.currencyCode || data.currencyCode)}
                      {" · "}
                      Discounts: {formatCurrency(order.totalDiscountAmount, order.currencyCode || data.currencyCode)}
                    </div>
                  </s-box>
                ))}
              </div>
            ) : (
              <s-paragraph>No orders are available in this window yet.</s-paragraph>
            )}
          </s-section>

          <s-section heading="SKU view">
            {data.skuRows.length > 0 ? (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {data.skuRows.map((sku) => (
                  <s-box key={`${sku.variantId ?? sku.sku}-${sku.latestMetricDate}`} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <strong>{sku.sku}</strong>
                    <div>Latest metric: {formatDate(sku.latestMetricDate)}</div>
                    <div>
                      Sales: {formatCurrency(sku.grossSalesAmount, data.currencyCode)}
                      {" · "}
                      Profit: {formatCurrency(sku.grossProfitBeforeAdSpend, data.currencyCode)}
                    </div>
                    <div>
                      Margin: {formatPercent(sku.grossMarginRate)}
                      {" · "}
                      Qty sold: {sku.quantitySold}
                      {" · "}
                      Orders: {sku.ordersCount}
                    </div>
                  </s-box>
                ))}
              </div>
            ) : (
              <s-paragraph>No SKU metrics are available in this window yet.</s-paragraph>
            )}
          </s-section>

          <s-section slot="aside" heading="Channel view">
            {data.channelRows.length > 0 ? (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {data.channelRows.map((channel) => (
                  <s-box key={channel.channelKey} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <strong>{channel.channelKey}</strong>
                    <div>
                      Sales: {formatCurrency(channel.grossSalesAmount, data.currencyCode)}
                      {" · "}
                      Profit: {formatCurrency(channel.grossProfitBeforeAdSpend, data.currencyCode)}
                    </div>
                    <div>
                      Margin: {formatPercent(channel.grossMarginRate)}
                      {" · "}
                      Refunds: {formatCurrency(channel.refundAmount, data.currencyCode)}
                    </div>
                    <div>
                      Shipping cost: {formatCurrency(channel.shippingCostAmount, data.currencyCode)}
                      {" · "}
                      Orders: {channel.ordersCount}
                    </div>
                  </s-box>
                ))}
              </div>
            ) : (
              <s-paragraph>No channel metrics are available in this window yet.</s-paragraph>
            )}
          </s-section>
        </>
      ) : (
        <s-section heading="Profit views">
          <s-paragraph>
            Generate daily rebuilds first so Profit Guard has enough metrics to render Orders / SKU /
            Channels views.
          </s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}
