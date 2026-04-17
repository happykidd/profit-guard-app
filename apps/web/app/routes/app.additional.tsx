import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getHealthSnapshot } from "../services/health.server";

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPercent(value?: string | number | null) {
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
  const [health, recentSyncRuns, recentWebhookEvents, recentDailyMetrics, latestHealthScore, latestCompletenessSnapshot] = await Promise.all([
    getHealthSnapshot(),
    db.syncRun.findMany({
      where: {
        shop: {
          shopDomain: session.shop,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
    db.webhookEvent.findMany({
      where: {
        shop: {
          shopDomain: session.shop,
        },
      },
      orderBy: {
        receivedAt: "desc",
      },
      take: 10,
    }),
    db.dailyShopMetric.findMany({
      where: {
        shop: {
          shopDomain: session.shop,
        },
      },
      orderBy: {
        metricDate: "desc",
      },
      take: 7,
    }),
    db.profitHealthScore.findFirst({
      where: {
        shop: {
          shopDomain: session.shop,
        },
      },
      orderBy: {
        scoreDate: "desc",
      },
    }),
    db.dataCompletenessSnapshot.findFirst({
      where: {
        shop: {
          shopDomain: session.shop,
        },
      },
      orderBy: {
        snapshotDate: "desc",
      },
    }),
  ]);

  return {
    health,
    latestCompletenessSnapshot: latestCompletenessSnapshot
      ? {
          snapshotDate: latestCompletenessSnapshot.snapshotDate.toISOString(),
          level: latestCompletenessSnapshot.level,
          variantCoverageRate: latestCompletenessSnapshot.variantCoverageRate?.toString() ?? null,
          orderCoverageRate: latestCompletenessSnapshot.orderCoverageRate?.toString() ?? null,
        }
      : null,
    latestHealthScore: latestHealthScore
      ? {
          scoreDate: latestHealthScore.scoreDate.toISOString(),
          score: latestHealthScore.score,
          levelLabel: latestHealthScore.levelLabel,
        }
      : null,
    recentDailyMetrics: recentDailyMetrics.map((metric) => ({
      id: metric.id,
      metricDate: metric.metricDate.toISOString(),
      ordersCount: metric.ordersCount,
      grossMarginRate: metric.grossMarginRate?.toString() ?? null,
      refundRate: metric.refundRate?.toString() ?? null,
      discountRate: metric.discountRate?.toString() ?? null,
      completenessLevel: metric.completenessLevel,
    })),
    recentSyncRuns: recentSyncRuns.map((run) => ({
      id: run.id,
      runType: run.runType,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    })),
    recentWebhookEvents: recentWebhookEvents.map((event) => ({
      id: event.id,
      topic: event.topic,
      status: event.status,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
  };
};

export default function AdditionalPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Operations">
      <s-section heading="System health">
        <s-paragraph>
          Overall status: <strong>{data.health.status}</strong>
        </s-paragraph>
        <s-paragraph>
          Checked at: {formatDate(data.health.checkedAt)}
        </s-paragraph>
        <s-paragraph>Database ready: {data.health.database.ready ? "Yes" : "No"}</s-paragraph>
        <s-paragraph>
          Shopify API key configured: {data.health.config.shopifyApiKeyConfigured ? "Yes" : "No"}
        </s-paragraph>
        <s-paragraph>
          Shopify app URL configured: {data.health.config.shopifyAppUrlConfigured ? "Yes" : "No"}
        </s-paragraph>
        <s-link href="/health" target="_blank">
          Open raw health JSON
        </s-link>
      </s-section>

      <s-section heading="Queue snapshot">
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(data.health.queue, null, 2)}
        </pre>
      </s-section>

      <s-section slot="aside" heading="Webhook snapshot">
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(data.health.webhooks, null, 2)}
        </pre>
      </s-section>

      <s-section heading="Profitability status">
        <s-paragraph>
          Latest score:
          {" "}
          <strong>
            {data.latestHealthScore ? `${data.latestHealthScore.score} (${data.latestHealthScore.levelLabel})` : "Not available"}
          </strong>
        </s-paragraph>
        <s-paragraph>
          Latest completeness:
          {" "}
          <strong>{data.latestCompletenessSnapshot?.level ?? "Not available"}</strong>
        </s-paragraph>
        <s-paragraph>
          Variant coverage: {formatPercent(data.latestCompletenessSnapshot?.variantCoverageRate)}
          {" · "}
          Order coverage: {formatPercent(data.latestCompletenessSnapshot?.orderCoverageRate)}
        </s-paragraph>
      </s-section>

      <s-section heading="Recent daily metrics">
        {data.recentDailyMetrics.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentDailyMetrics.map((metric) => (
              <s-box
                key={metric.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{formatDate(metric.metricDate)}</strong>
                <div>Orders: {metric.ordersCount}</div>
                <div>
                  Margin: {formatPercent(metric.grossMarginRate)} · Refunds: {formatPercent(metric.refundRate)}
                </div>
                <div>
                  Discounts: {formatPercent(metric.discountRate)} · Completeness: {metric.completenessLevel}
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No daily rebuild has been generated yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Recent sync activity">
        {data.recentSyncRuns.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentSyncRuns.map((run) => (
              <s-box
                key={run.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{run.runType}</strong>
                <div>Status: {run.status}</div>
                <div>Created: {formatDate(run.createdAt)}</div>
                <div>Finished: {formatDate(run.finishedAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No sync activity yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Recent webhook events">
        {data.recentWebhookEvents.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentWebhookEvents.map((event) => (
              <s-box
                key={event.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{event.topic}</strong>
                <div>Status: {event.status}</div>
                <div>Received: {formatDate(event.receivedAt)}</div>
                <div>Processed: {formatDate(event.processedAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No webhook events recorded yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
