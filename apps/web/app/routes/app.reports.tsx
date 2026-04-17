import { ReportType } from "@prisma/client";
import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  buildReportExportResponse,
  generateReportSnapshot,
  getReportsOverview,
  prepareDigestDeliveries,
  transitionDigestDelivery,
} from "../services/reports.server";

type ReportsActionData = {
  message: string;
  status: "error" | "success";
};

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

function formatPercent(value?: string | null) {
  if (!value) {
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

function formatDigestStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const overview = await getReportsOverview(session.shop);

  return (
    overview ?? {
      currencyCode: "USD",
      dailyReport: null,
      latestMetricDate: null,
      recentDigestDeliveries: [],
      recentExports: [],
      shopId: null,
      shopName: session.shop,
      weeklyReport: null,
    }
  );
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ReportsActionData | Response> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const exportFormat = String(formData.get("exportFormat") || "").trim();
  const reportTypeInput = String(formData.get("reportType") || "").trim().toUpperCase();
  const reportType = reportTypeInput === "WEEKLY" ? ReportType.WEEKLY : ReportType.DAILY;

  try {
    if (intent === "generate_report") {
      await generateReportSnapshot({
        reportType,
        shopDomain: session.shop,
      });

      return redirect("/app/reports");
    }

    if (intent === "export_report") {
      return buildReportExportResponse({
        exportFormat,
        reportType,
        shopDomain: session.shop,
      });
    }

    if (intent === "prepare_digest") {
      const result = await prepareDigestDeliveries({
        reportType,
        shopDomain: session.shop,
      });

      return {
        message: `Prepared ${result.preparedCount} ${reportType.toLowerCase()} digest delivery record(s).`,
        status: "success",
      };
    }

    if (intent === "mark_digest_sent" || intent === "mark_digest_failed" || intent === "retry_digest") {
      const deliveryId = String(formData.get("deliveryId") || "").trim();

      if (!deliveryId) {
        throw new Error("Digest delivery id is required.");
      }

      const nextStatus =
        intent === "mark_digest_sent" ? "SENT" : intent === "mark_digest_failed" ? "FAILED" : "PREPARED";
      const updatedDelivery = await transitionDigestDelivery({
        deliveryId,
        errorMessage:
          nextStatus === "FAILED" ? String(formData.get("errorMessage") || "").trim() || "Manual failure note." : null,
        shopDomain: session.shop,
        status: nextStatus,
      });

      return {
        message:
          nextStatus === "PREPARED"
            ? `Digest delivery for ${updatedDelivery.recipientEmail} moved back to prepared state.`
            : `Digest delivery for ${updatedDelivery.recipientEmail} marked ${nextStatus.toLowerCase()}.`,
        status: "success",
      };
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Report action failed.",
      status: "error",
    };
  }

  return {
    message: "Unsupported report action.",
    status: "error",
  };
};

function ReportCard(props: {
  currencyCode: string;
  report: Awaited<ReturnType<typeof loader>>["dailyReport"] | Awaited<ReturnType<typeof loader>>["weeklyReport"];
  reportType: "DAILY" | "WEEKLY";
  isSubmitting: boolean;
}) {
  const exportOptions = [
    { format: "json", label: "Export JSON" },
    { format: "markdown", label: "Export Markdown" },
    { format: "csv", label: "Export CSV" },
    { format: "html", label: "Export HTML" },
    { format: "email_text", label: "Export Email TXT" },
    { format: "pdf", label: "Export PDF" },
    { format: "share_image", label: "Export Share Image" },
  ] as const;

  return (
    <s-box padding="large" borderWidth="base" borderRadius="large" background="subdued">
      <div style={{ display: "grid", gap: "0.75rem" }}>
        <div>
          <strong>{props.reportType === "DAILY" ? "Daily Summary" : "Weekly Summary"}</strong>
        </div>

        {props.report ? (
          <>
            <div>{props.report.payload.narrative.headline}</div>
            <div style={{ color: "#4b5563" }}>{props.report.payload.narrative.summary}</div>
            <div>
              Window: {props.report.payload.period.label} · Generated:{" "}
              {formatDate(props.report.payload.generator.generatedAt)}
            </div>
            <div style={{ display: "grid", gap: "0.5rem", gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))" }}>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Gross sales</strong>
                <div>{formatCurrency(props.report.payload.kpis.grossSalesAmount, props.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Gross profit</strong>
                <div>{formatCurrency(props.report.payload.kpis.grossProfitBeforeAdSpend, props.currencyCode)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Margin</strong>
                <div>{formatPercent(props.report.payload.kpis.grossMarginRate)}</div>
              </s-box>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>Orders</strong>
                <div>{props.report.payload.kpis.ordersCount}</div>
              </s-box>
            </div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <strong>Highlights</strong>
              {props.report.payload.highlights.map((highlight) => (
                <s-paragraph key={highlight}>{highlight}</s-paragraph>
              ))}
            </div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <strong>Watchouts</strong>
              {props.report.payload.watchouts.map((watchout) => (
                <s-paragraph key={watchout}>{watchout}</s-paragraph>
              ))}
            </div>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <strong>Top alerts</strong>
              {props.report.payload.topAlerts.length > 0 ? (
                props.report.payload.topAlerts.map((alert) => (
                  <s-box key={`${alert.alertType}:${alert.detectedForDate}`} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                    <strong>{alert.title}</strong>
                    <div>
                      {alert.severity} · {alert.alertType} · {formatDate(alert.detectedForDate)}
                    </div>
                    <div>
                      Impact: {formatCurrency(alert.impactAmount, alert.currencyCode || props.currencyCode)}
                    </div>
                  </s-box>
                ))
              ) : (
                <s-paragraph>No alerts included in this report window.</s-paragraph>
              )}
            </div>
          </>
        ) : (
          <s-paragraph>No snapshot generated yet.</s-paragraph>
        )}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Form method="post">
            <input type="hidden" name="intent" value="generate_report" />
            <input type="hidden" name="reportType" value={props.reportType} />
            <button
              type="submit"
              disabled={props.isSubmitting}
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
              {props.report ? "Regenerate snapshot" : "Generate snapshot"}
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="prepare_digest" />
            <input type="hidden" name="reportType" value={props.reportType} />
            <button
              type="submit"
              disabled={props.isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #0f766e",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#ecfdf5",
                color: "#0f766e",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Prepare digest queue
            </button>
          </Form>
          {exportOptions.map((option) => (
            <Form key={option.format} method="post">
              <input type="hidden" name="intent" value="export_report" />
              <input type="hidden" name="reportType" value={props.reportType} />
              <input type="hidden" name="exportFormat" value={option.format} />
              <button
                type="submit"
                disabled={props.isSubmitting}
                style={{
                  appearance: "none",
                  border: "1px solid #1d4ed8",
                  borderRadius: "999px",
                  padding: "0.65rem 1rem",
                  background: "#ffffff",
                  color: "#1d4ed8",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            </Form>
          ))}
        </div>
      </div>
    </s-box>
  );
}

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as ReportsActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const activeGenerator =
    data.dailyReport?.payload.generator ??
    data.weeklyReport?.payload.generator ??
    null;

  return (
    <s-page heading="Reports">
      {actionData ? (
        <s-section heading={actionData.status === "success" ? "Latest report update" : "Report issue"}>
          <s-paragraph>
            <strong>{actionData.message}</strong>
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Reports workspace">
        <s-paragraph>
          Shop: <strong>{data.shopName}</strong>
        </s-paragraph>
        <s-paragraph>
          Latest metric date: <strong>{formatDate(data.latestMetricDate)}</strong>
        </s-paragraph>
        <s-paragraph>
          {activeGenerator?.mode === "openai-assisted"
            ? `Current reports are being generated with ${activeGenerator.provider} (${activeGenerator.modelName}) and numeric guardrails. If the AI response fails validation, Profit Guard automatically falls back to the structured summary template.`
            : "这里的 daily / weekly reports 目前走 rules-first fallback 生成，直接复用 daily metrics、health、completeness 和 top alerts，不依赖外部 AI 才能稳定工作。现在也能直接导出 HTML / Email TXT / PDF / Share Image，方便把 daily 或 weekly summary 发给商家、支持或内部复盘。"}
        </s-paragraph>
      </s-section>

      <s-section heading="Daily report">
        <ReportCard currencyCode={data.currencyCode} report={data.dailyReport} reportType="DAILY" isSubmitting={isSubmitting} />
      </s-section>

      <s-section heading="Weekly report">
        <ReportCard currencyCode={data.currencyCode} report={data.weeklyReport} reportType="WEEKLY" isSubmitting={isSubmitting} />
      </s-section>

      <s-section heading="Recent export log">
        {data.recentExports.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentExports.map((reportExport) => (
              <s-box key={reportExport.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{reportExport.reportType}</strong>
                <div>
                  Format: {reportExport.exportFormat} · Status: {reportExport.status}
                </div>
                <div>Created: {formatDate(reportExport.createdAt)}</div>
                <div>Storage key: {reportExport.storageKey || "inline export"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No report exports yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Digest delivery history">
        <s-paragraph>
          这里会保留最近的 daily / weekly digest delivery records，方便支持团队看 prepared、failed、
          sent 的状态流转，并手动重试或标记结果。
        </s-paragraph>
        {data.recentDigestDeliveries.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentDigestDeliveries.map((delivery) => (
              <s-box key={delivery.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  <strong>{delivery.subject}</strong>
                  <div>
                    {delivery.reportType} · {delivery.exportFormat} · {formatDigestStatus(delivery.status)}
                  </div>
                  <div>
                    Recipient: {delivery.recipientEmail} · Attempts: {delivery.attemptCount}
                  </div>
                  <div>
                    Last attempt: {formatDate(delivery.lastAttemptAt)} · Delivered: {formatDate(delivery.deliveredAt)}
                  </div>
                  <div>Last error: {delivery.lastError || "None"}</div>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="retry_digest" />
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <button
                      type="submit"
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
                      Retry
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="mark_digest_sent" />
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #0f766e",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#ecfdf5",
                        color: "#0f766e",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Mark sent
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="mark_digest_failed" />
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <input type="hidden" name="errorMessage" value="Manual delivery verification failed." />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #b91c1c",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#ffffff",
                        color: "#b91c1c",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Mark failed
                    </button>
                  </Form>
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No digest deliveries prepared yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
