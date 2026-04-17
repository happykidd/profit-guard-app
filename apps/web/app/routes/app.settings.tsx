import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  buildSettingsExportResponse,
  getSettingsOverview,
  upsertNotificationPreference,
  upsertDefaultTransactionFeeProfile,
} from "../services/settings.server";

type SettingsActionData = {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return getSettingsOverview(session.shop);
};

export const action = async ({ request }: ActionFunctionArgs): Promise<SettingsActionData | Response> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();

  try {
    if (intent === "save_transaction_fee") {
      await upsertDefaultTransactionFeeProfile({
        currencyCode: String(formData.get("currencyCode") || ""),
        fixedFeeAmount: String(formData.get("fixedFeeAmount") || ""),
        percentageRate: String(formData.get("percentageRate") || ""),
        shopDomain: session.shop,
      });

      return redirect("/app/settings?updated=1");
    }

    if (intent === "save_notification_preferences") {
      await upsertNotificationPreference({
        alertDigestEnabled: formData.get("alertDigestEnabled") === "on",
        dailySummaryEnabled: formData.get("dailySummaryEnabled") === "on",
        preferredSendHour: String(formData.get("preferredSendHour") || ""),
        recipientEmailsRaw: String(formData.get("recipientEmails") || ""),
        replyToEmail: String(formData.get("replyToEmail") || ""),
        shopDomain: session.shop,
        timezoneOverride: String(formData.get("timezoneOverride") || ""),
        weeklySummaryEnabled: formData.get("weeklySummaryEnabled") === "on",
      });

      return redirect("/app/settings?notifications=1");
    }

    if (intent === "export_data") {
      return buildSettingsExportResponse({
        exportKind: String(formData.get("exportKind") || ""),
        shopDomain: session.shop,
      });
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Settings action failed.",
      status: "error",
    };
  }

  return {
    message: "Unsupported settings action.",
    status: "error",
  };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as SettingsActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (!data) {
    return (
      <s-page heading="Settings">
        <s-section heading="Shop settings">
          <s-paragraph>Shop record not found.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Settings">
      {actionData ? (
        <s-section heading={actionData.status === "success" ? "Settings updated" : "Settings issue"}>
          <s-paragraph>
            <strong>{actionData.message}</strong>
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Store profile">
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div>Shop: <strong>{data.shop.shopName}</strong></div>
          <div>Domain: {data.shop.shopDomain}</div>
          <div>Plan: {data.shop.currentPlan} · Status: {data.shop.subscriptionStatus}</div>
          <div>Currency: {data.shop.currencyCode} · Timezone: {data.shop.ianaTimezone ?? "Not available"}</div>
          <div>Installed: {formatDate(data.shop.installedAt)} · Last sync: {formatDate(data.shop.lastSyncedAt)}</div>
          <div>Backfill: {data.shop.backfillStatus} · Active: {data.shop.isActive ? "Yes" : "No"}</div>
          <div>Support email: {data.summary.supportEmail}</div>
        </div>
      </s-section>

      <s-section heading="Default transaction fee profile">
        <s-paragraph>
          This profile is used by the worker when Shopify transaction details are not rich enough to
          derive an exact fee. Keep it aligned with your current payment stack assumptions.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save_transaction_fee" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "28rem" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Percentage rate (0-1)</span>
              <input
                type="number"
                name="percentageRate"
                step="0.0001"
                min="0"
                max="1"
                defaultValue={data.transactionFeeProfile?.percentageRate ?? "0.0290"}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Fixed fee amount</span>
              <input
                type="number"
                name="fixedFeeAmount"
                step="0.0001"
                min="0"
                defaultValue={data.transactionFeeProfile?.fixedFeeAmount ?? "0.3000"}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Currency</span>
              <input
                type="text"
                name="currencyCode"
                defaultValue={data.transactionFeeProfile?.currencyCode ?? data.shop.currencyCode}
              />
            </label>
            <div style={{ color: "#4b5563" }}>
              Current profile effective from: {formatDate(data.transactionFeeProfile?.effectiveFrom ?? null)}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #111827",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#111827",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                width: "fit-content",
              }}
            >
              Save fee profile
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Notification and digest preferences">
        <s-paragraph>
          控制 daily / weekly summary 和 alert digest 的邮件收件人、发送时段与 reply-to 信息。当前这层先完成
          配置与导出留档，后续接真实邮件服务时可以直接复用。
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="save_notification_preferences" />
          <div style={{ display: "grid", gap: "0.75rem", maxWidth: "34rem" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="dailySummaryEnabled"
                defaultChecked={data.notificationPreference?.dailySummaryEnabled ?? true}
              />
              <span>Enable daily summary</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="weeklySummaryEnabled"
                defaultChecked={data.notificationPreference?.weeklySummaryEnabled ?? true}
              />
              <span>Enable weekly summary</span>
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                name="alertDigestEnabled"
                defaultChecked={data.notificationPreference?.alertDigestEnabled ?? true}
              />
              <span>Enable alert digest</span>
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Recipients</span>
              <textarea
                name="recipientEmails"
                rows={4}
                defaultValue={data.notificationPreference?.recipientEmails.join(", ") ?? data.shop.email ?? ""}
                placeholder="owner@example.com, ops@example.com"
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Reply-to email</span>
              <input
                type="email"
                name="replyToEmail"
                defaultValue={data.notificationPreference?.replyToEmail ?? data.summary.supportEmail}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Preferred send hour (0-23)</span>
              <input
                type="number"
                name="preferredSendHour"
                min="0"
                max="23"
                step="1"
                defaultValue={data.notificationPreference?.preferredSendHour ?? "8"}
              />
            </label>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Timezone override</span>
              <input
                type="text"
                name="timezoneOverride"
                defaultValue={data.notificationPreference?.timezoneOverride ?? data.shop.ianaTimezone ?? ""}
                placeholder="Asia/Shanghai"
              />
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #111827",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#111827",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                width: "fit-content",
              }}
            >
              Save notification preferences
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Data export">
        <s-paragraph>
          导出区现在除了 alerts / costs / summaries 之外，还提供一个完整的 portability bundle，用于卸载、
          support handoff 或内部留档。
        </s-paragraph>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {data.exportCapabilities.map((capability) => (
            <s-box key={capability.exportKind} padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <strong>{capability.label}</strong>
              <div style={{ marginTop: "0.35rem", color: "#4b5563" }}>{capability.description}</div>
              <Form method="post" style={{ marginTop: "0.75rem" }}>
                <input type="hidden" name="intent" value="export_data" />
                <input type="hidden" name="exportKind" value={capability.exportKind} />
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
                  Download
                </button>
              </Form>
            </s-box>
          ))}
        </div>
      </s-section>

      <s-section heading="Uninstall and portability">
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            Current state: <strong>{data.uninstallPolicy.currentState}</strong>
          </div>
          <div>Uninstalled at: {formatDate(data.uninstallPolicy.uninstalledAt)}</div>
          <div>Open alert threads: {data.uninstallPolicy.openAlertThreadCount}</div>
          <div>Queued or running syncs: {data.uninstallPolicy.activeSyncRunCount}</div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <strong>What Profit Guard does on uninstall</strong>
            {data.uninstallPolicy.cleanupActions.map((action) => (
              <s-paragraph key={action}>{action}</s-paragraph>
            ))}
          </div>
        </div>
      </s-section>

      <s-section slot="aside" heading="System snapshot">
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div>Stored reports: {data.summary.reportCount}</div>
          <div>Stored alerts: {data.summary.alertCount}</div>
          <div>Open alert threads: {data.summary.openAlertThreadCount}</div>
          <div>Active sync runs: {data.summary.activeSyncRunCount}</div>
        </div>
      </s-section>

      <s-section slot="aside" heading="Recent webhooks">
        {data.recentWebhookEvents.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentWebhookEvents.map((event) => (
              <s-box key={event.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{event.topic}</strong>
                <div>Status: {event.status}</div>
                <div>Received: {formatDate(event.receivedAt)}</div>
                <div>Processed: {formatDate(event.processedAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No webhook events have been recorded yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
