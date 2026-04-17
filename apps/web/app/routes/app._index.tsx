import { SyncRunType } from "@prisma/client";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { buildAlertBrief } from "../services/alert-playbooks.server";
import {
  resolveAlertStatusIntent,
  transitionAlertStatus,
} from "../services/alerts.server";
import { BILLING_TEST_MODE } from "../services/billing-config.server";
import { getStoredBillingState } from "../services/billing.server";

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value?: string | number | null, currencyCode = "USD") {
  if (value == null) {
    return "Not available";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericValue);
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

function formatPlatformActivityTitle(topic: string) {
  const normalized = topic.trim().toLowerCase();

  if (normalized.includes("app/uninstalled")) {
    return "App uninstalled";
  }

  if (normalized.includes("app/scopes_update") || normalized.includes("app_scopes_update")) {
    return "Permissions updated";
  }

  if (normalized.includes("shop/update") || normalized.includes("shop_update")) {
    return "Store settings updated";
  }

  if (normalized.includes("app_subscriptions/update") || normalized.includes("app/subscriptions/update")) {
    return "Subscription updated";
  }

  return topic
    .replace(/[_/]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getRecommendedNextStep(input: {
  recentDailyMetricsCount: number;
  activeAlertsCount: number;
  subscriptionStatus: string;
  trialEndsAt?: string | null;
}) {
  if (input.recentDailyMetricsCount === 0) {
    return {
      title: "Run your first rebuild",
      body: "Profit Guard is installed, but no daily profitability metrics are available yet. Queue a daily rebuild to generate your first dashboard, alerts, and reports.",
      ctaLabel: "Queue daily rebuild",
      queueIntent: "queue_daily",
    } as const;
  }

  if (input.activeAlertsCount > 0) {
    return {
      title: "Review active alerts",
      body: "Your store has active alerts that may affect margin, refunds, or data quality. Review the queue and resolve the highest-impact items first.",
      ctaLabel: "Open Alerts",
      href: "/app/alerts",
    } as const;
  }

  if (input.subscriptionStatus === "TRIALING" && input.trialEndsAt) {
    const remainingMs = new Date(input.trialEndsAt).getTime() - Date.now();
    const remainingDays = remainingMs / (1000 * 60 * 60 * 24);

    if (Number.isFinite(remainingDays) && remainingDays <= 7) {
      return {
        title: "Review your billing plan",
        body: "Your trial is ending soon. Confirm the right plan so Profit Guard can keep monitoring your store without interruption.",
        ctaLabel: "Open Billing",
        href: "/app/billing",
      } as const;
    }
  }

  return {
    title: "Review the latest report",
    body: "Your profitability summary is ready. Open the reports workspace to review highlights, watchouts, and recommended actions.",
    ctaLabel: "Open Reports",
    href: "/app/reports",
  } as const;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const [shop, recentSyncRuns, recentWebhookEvents, recentDailyMetrics, latestHealthScore, latestCompletenessSnapshot, topAlerts, billingState] = await Promise.all([
    db.shop.findUnique({
      where: {
        shopDomain,
      },
    }),
    db.syncRun.findMany({
      where: {
        shop: {
          shopDomain,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    }),
    db.webhookEvent.findMany({
      where: {
        shop: {
          shopDomain,
        },
      },
      orderBy: {
        receivedAt: "desc",
      },
      take: 5,
    }),
    db.dailyShopMetric.findMany({
      where: {
        shop: {
          shopDomain,
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
          shopDomain,
        },
      },
      orderBy: {
        scoreDate: "desc",
      },
    }),
    db.dataCompletenessSnapshot.findFirst({
      where: {
        shop: {
          shopDomain,
        },
      },
      orderBy: {
        snapshotDate: "desc",
      },
    }),
    db.alert.findMany({
      where: {
        shop: {
          shopDomain,
        },
        status: {
          in: ["NEW", "READ"],
        },
      },
      orderBy: [
        {
          rankScore: "desc",
        },
        {
          detectedForDate: "desc",
        },
      ],
      take: 5,
    }),
    getStoredBillingState(shopDomain),
  ]);

  return {
    billingState: {
      ...billingState,
      trialEndsAt: billingState.trialEndsAt?.toISOString() ?? null,
    },
    isBillingTestMode: BILLING_TEST_MODE,
    recentSyncRuns: recentSyncRuns.map((run) => ({
      id: run.id,
      runType: run.runType,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      recordsSynced: run.recordsSynced,
      errorMessage: run.errorMessage,
    })),
    recentWebhookEvents: recentWebhookEvents.map((event) => ({
      id: event.id,
      topic: event.topic,
      status: event.status,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
    })),
    recentDailyMetrics: recentDailyMetrics.map((metric) => ({
      id: metric.id,
      metricDate: metric.metricDate.toISOString(),
      ordersCount: metric.ordersCount,
      grossSalesAmount: metric.grossSalesAmount.toString(),
      grossProfitBeforeAdSpend: metric.grossProfitBeforeAdSpend.toString(),
      grossMarginRate: metric.grossMarginRate?.toString() ?? null,
      refundRate: metric.refundRate?.toString() ?? null,
      discountRate: metric.discountRate?.toString() ?? null,
      completenessLevel: metric.completenessLevel,
    })),
    latestHealthScore: latestHealthScore
      ? {
          scoreDate: latestHealthScore.scoreDate.toISOString(),
          score: latestHealthScore.score,
          levelLabel: latestHealthScore.levelLabel,
        }
      : null,
    latestCompletenessSnapshot: latestCompletenessSnapshot
      ? {
          snapshotDate: latestCompletenessSnapshot.snapshotDate.toISOString(),
          level: latestCompletenessSnapshot.level,
          variantCoverageRate: latestCompletenessSnapshot.variantCoverageRate?.toString() ?? null,
          orderCoverageRate: latestCompletenessSnapshot.orderCoverageRate?.toString() ?? null,
        }
      : null,
    topAlerts: topAlerts.map((alert) => ({
      id: alert.id,
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      entityType: alert.entityType,
      entityKey: alert.entityKey,
      detectedForDate: alert.detectedForDate.toISOString(),
      impactAmount: alert.impactAmount?.toString() ?? null,
      currencyCode: alert.currencyCode ?? null,
      confidenceLevel: alert.confidenceLevel,
      completenessLevel: alert.completenessLevel,
      brief: buildAlertBrief({
        alertType: alert.alertType,
        completenessLevel: alert.completenessLevel,
        confidenceLevel: alert.confidenceLevel,
        currencyCode: alert.currencyCode ?? null,
        entityKey: alert.entityKey,
        entityType: alert.entityType,
        impactAmount: alert.impactAmount?.toString() ?? null,
        rulePayload: alert.rulePayload,
        severity: alert.severity,
        title: alert.title,
      }),
    })),
    shop: shop
      ? {
          shopDomain: shop.shopDomain,
          shopName: shop.shopName,
          email: shop.email,
          currencyCode: shop.currencyCode,
          ianaTimezone: shop.ianaTimezone,
          backfillStatus: shop.backfillStatus,
          installedAt: shop.installedAt.toISOString(),
          lastSyncedAt: shop.lastSyncedAt?.toISOString() ?? null,
          currentPlan: shop.currentPlan,
          subscriptionStatus: shop.subscriptionStatus,
          isActive: shop.isActive,
        }
      : {
          shopDomain,
          shopName: null,
          email: null,
          currencyCode: null,
          ianaTimezone: null,
          backfillStatus: "NOT_STARTED",
          installedAt: null,
          lastSyncedAt: null,
          currentPlan: "FREE",
          subscriptionStatus: "TRIALING",
          isActive: true,
        },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const alertId = typeof formData.get("alertId") === "string" ? String(formData.get("alertId")).trim() : "";
  const shop = await db.shop.findUnique({
    where: {
      shopDomain: session.shop,
    },
    select: {
      id: true,
    },
  });

  const runTypeByIntent: Record<string, SyncRunType> = {
    queue_bootstrap: SyncRunType.SHOP_BOOTSTRAP,
    queue_products: SyncRunType.PRODUCT_BACKFILL,
    queue_orders: SyncRunType.ORDER_BACKFILL,
    queue_daily: SyncRunType.DAILY_REBUILD,
  };

  const runType = typeof intent === "string" ? runTypeByIntent[intent] : null;
  const alertStatus = typeof intent === "string" ? resolveAlertStatusIntent(intent) : null;

  if (alertId && alertStatus) {
    await transitionAlertStatus({
      shopDomain: session.shop,
      alertId,
      nextStatus: alertStatus,
      note: "Dashboard quick action",
    });

    return redirect("/app");
  }

  if (shop && runType) {
    const existing = await db.syncRun.findFirst({
      where: {
        shopId: shop.id,
        runType,
        status: {
          in: ["QUEUED", "RUNNING"],
        },
      },
    });

    if (!existing) {
      await db.syncRun.create({
        data: {
          shopId: shop.id,
          runType,
          status: "QUEUED",
          metadata: {
            trigger: "dashboard_manual",
          },
        },
      });
    }
  }

  return redirect("/app");
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const activeSubscription = data.billingState.appSubscriptions[0] ?? null;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const recommendedNextStep = getRecommendedNextStep({
    recentDailyMetricsCount: data.recentDailyMetrics.length,
    activeAlertsCount: data.topAlerts.length,
    subscriptionStatus: data.billingState.subscriptionStatus,
    trialEndsAt: data.billingState.trialEndsAt,
  });

  return (
    <s-page heading="Profit Guard Dashboard">
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Form method="post">
          <input type="hidden" name="intent" value="queue_bootstrap" />
          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #111827",
              borderRadius: "999px",
              padding: "0.65rem 1rem",
              background: "#111827",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Queue shop bootstrap
          </button>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="queue_products" />
          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #111827",
              borderRadius: "999px",
              padding: "0.65rem 1rem",
              background: "#ffffff",
              color: "#111827",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Queue product backfill
          </button>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="queue_orders" />
          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #111827",
              borderRadius: "999px",
              padding: "0.65rem 1rem",
              background: "#ffffff",
              color: "#111827",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Queue order backfill
          </button>
        </Form>

        <Form method="post">
          <input type="hidden" name="intent" value="queue_daily" />
          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #0f766e",
              borderRadius: "999px",
              padding: "0.65rem 1rem",
              background: "#ecfeff",
              color: "#115e59",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Queue daily rebuild
          </button>
        </Form>
      </div>

      <s-section heading="Store status">
        <s-paragraph>
          Current store: <strong>{data.shop.shopName || data.shop.shopDomain}</strong>
        </s-paragraph>
        <s-paragraph>
          Installation status: {data.shop.isActive ? "Active" : "Inactive"} · Plan:
          {" "}
          {data.billingState.currentPlan}
        </s-paragraph>
        <s-paragraph>
          Currency: {data.shop.currencyCode || "Unknown"} · Timezone:
          {" "}
          {data.shop.ianaTimezone || "Unknown"} · Last sync:
          {" "}
          {formatDate(data.shop.lastSyncedAt)}
        </s-paragraph>
        <s-paragraph>
          Historical sync status: <strong>{data.shop.backfillStatus}</strong>
        </s-paragraph>
      </s-section>

      <s-section heading="Billing overview">
        <s-paragraph>
          Current subscription status: <strong>{data.billingState.subscriptionStatus}</strong>
        </s-paragraph>
        <s-paragraph>
          {activeSubscription
            ? `Active subscription: ${activeSubscription.name} · ${activeSubscription.displayPrice || "Price unavailable"}`
            : "No active paid subscription. Profit Guard is currently running in trial or free mode."}
        </s-paragraph>
        <s-paragraph>
          Trial ends: {formatDate(data.billingState.trialEndsAt)}
          {" · "}
          Billing mode: {data.isBillingTestMode ? "Test" : "Live"}
        </s-paragraph>
        <s-link href="/app/billing">Open billing center</s-link>
      </s-section>

      <s-section heading="Latest profitability pulse">
        {data.recentDailyMetrics.length > 0 ? (
          <>
            <s-paragraph>
              Latest metric date: <strong>{formatDate(data.recentDailyMetrics[0].metricDate)}</strong>
            </s-paragraph>
            <s-paragraph>
              Yesterday gross sales: {formatCurrency(data.recentDailyMetrics[0].grossSalesAmount, data.shop.currencyCode || "USD")}
              {" · "}
              Estimated gross profit: {formatCurrency(data.recentDailyMetrics[0].grossProfitBeforeAdSpend, data.shop.currencyCode || "USD")}
            </s-paragraph>
            <s-paragraph>
              Gross margin: {formatPercent(data.recentDailyMetrics[0].grossMarginRate)}
              {" · "}
              Refund rate: {formatPercent(data.recentDailyMetrics[0].refundRate)}
              {" · "}
              Discount rate: {formatPercent(data.recentDailyMetrics[0].discountRate)}
            </s-paragraph>
            <s-paragraph>
              Completeness: <strong>{data.latestCompletenessSnapshot?.level ?? data.recentDailyMetrics[0].completenessLevel}</strong>
              {" · "}
              Profit health score:
              {" "}
              <strong>
                {data.latestHealthScore ? `${data.latestHealthScore.score} (${data.latestHealthScore.levelLabel})` : "Not available"}
              </strong>
            </s-paragraph>
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
                    Gross sales: {formatCurrency(metric.grossSalesAmount, data.shop.currencyCode || "USD")}
                  </div>
                  <div>
                    Gross profit: {formatCurrency(metric.grossProfitBeforeAdSpend, data.shop.currencyCode || "USD")}
                  </div>
                  <div>
                    Margin: {formatPercent(metric.grossMarginRate)} · Completeness: {metric.completenessLevel}
                  </div>
                </s-box>
              ))}
            </div>
          </>
        ) : (
          <s-paragraph>No daily profitability metrics yet. Queue a daily rebuild after order sync.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Top alerts">
        {data.topAlerts.length > 0 ? (
          <>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              {data.topAlerts.map((alert) => (
                <s-box
                  key={alert.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <strong>{alert.title}</strong>
                  <div>Severity: {alert.severity}</div>
                  <div>
                    Scope: {alert.entityType} / {alert.entityKey}
                  </div>
                  <div>
                    Impact: {formatCurrency(alert.impactAmount, alert.currencyCode || data.shop.currencyCode || "USD")}
                  </div>
                  <div>
                    Date: {formatDate(alert.detectedForDate)} · Confidence: {alert.confidenceLevel} · Completeness:{" "}
                    {alert.completenessLevel}
                  </div>
                  <div style={{ marginTop: "0.5rem" }}>{alert.brief.summary}</div>
                  <div style={{ marginTop: "0.35rem", color: "#374151" }}>
                    Next action: {alert.brief.primaryAction}
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                    <Form method="post">
                      <input type="hidden" name="alertId" value={alert.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="mark_read"
                        disabled={isSubmitting}
                        style={{
                          appearance: "none",
                          border: "1px solid #1d4ed8",
                          borderRadius: "999px",
                          padding: "0.55rem 0.9rem",
                          background: "#ffffff",
                          color: "#1d4ed8",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Mark read
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="alertId" value={alert.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="resolve"
                        disabled={isSubmitting}
                        style={{
                          appearance: "none",
                          border: "1px solid #0f766e",
                          borderRadius: "999px",
                          padding: "0.55rem 0.9rem",
                          background: "#ffffff",
                          color: "#0f766e",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Resolve
                      </button>
                    </Form>
                    <s-link href={`/app/alerts/${alert.id}`}>Open detail</s-link>
                  </div>
                </s-box>
              ))}
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <s-link href="/app/alerts">Open full alert queue</s-link>
            </div>
          </>
        ) : (
          <s-paragraph>No active alerts yet. Daily rebuild will populate the first rule hits here.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Recent sync runs">
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
                <div>Records synced: {run.recordsSynced}</div>
                {run.errorMessage ? <div>Error: {run.errorMessage}</div> : null}
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No sync runs recorded yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Recommended next step">
        <s-paragraph>
          <strong>{recommendedNextStep.title}</strong>
        </s-paragraph>
        <s-paragraph>{recommendedNextStep.body}</s-paragraph>
        {"queueIntent" in recommendedNextStep ? (
          <Form method="post">
            <input type="hidden" name="intent" value={recommendedNextStep.queueIntent} />
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #111827",
                borderRadius: "999px",
                padding: "0.55rem 0.9rem",
                background: "#111827",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {recommendedNextStep.ctaLabel}
            </button>
          </Form>
        ) : (
          <s-link href={recommendedNextStep.href}>{recommendedNextStep.ctaLabel}</s-link>
        )}
      </s-section>

      <s-section slot="aside" heading="Platform activity">
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
                <strong>{formatPlatformActivityTitle(event.topic)}</strong>
                <div>Status: {event.status}</div>
                <div>Received: {formatDate(event.receivedAt)}</div>
                <div>Processed: {formatDate(event.processedAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No recent platform activity has been recorded yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Quick links">
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <s-link href="/app/alerts">Open Alerts</s-link>
          <s-link href="/app/reports">Open Reports</s-link>
          <s-link href="/app/costs">Open Cost Center</s-link>
          <s-link href="/app/billing">Open Billing</s-link>
          <s-link href="/docs">View support docs</s-link>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
