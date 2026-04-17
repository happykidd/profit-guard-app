import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  deleteAlertSavedView,
  getAlertsOverview,
  resolveAlertFilters,
  resolveAlertSavedViewVisibility,
  resolveAlertStatusIntent,
  resolveAlertWorkflowIntent,
  saveAlertSavedView,
  transitionAlertsStatus,
  transitionAlertThreadsStatus,
  transitionAlertStatus,
  transitionAlertThreadStatus,
  updateAlertThreadWorkflow,
  updateAlertThreadsWorkflow,
} from "../services/alerts.server";

type AlertsActionData = {
  message: string;
  status: "success" | "error";
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
  }).format(numericValue);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const filters = resolveAlertFilters(new URL(request.url).searchParams);
  const overview = await getAlertsOverview({
    shopDomain: session.shop,
    filters,
  });

  return overview ?? {
    activeAlerts: [],
    activeThreads: [],
    availableAlertTypes: [],
    availableEntityTypes: [],
    criticalAlertsCount: 0,
    currencyCode: "USD",
    filters,
    openThreadsCount: 0,
    recentClosedAlerts: [],
    savedViews: [],
    shopId: null,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<AlertsActionData | Response> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const alertId = String(formData.get("alertId") || "").trim();
  const threadId = String(formData.get("threadId") || "").trim();
  const selectedAlertIds = formData
    .getAll("selectedAlertIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const selectedThreadIds = formData
    .getAll("selectedThreadIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const savedViewId = String(formData.get("savedViewId") || "").trim();
  const savedViewName = String(formData.get("savedViewName") || "").trim();
  const savedViewVisibility = resolveAlertSavedViewVisibility(String(formData.get("savedViewVisibility") || ""));
  const savedViewDescription = String(formData.get("savedViewDescription") || "").trim() || null;
  const savedViewCreatedByLabel = String(formData.get("savedViewCreatedByLabel") || "").trim() || null;
  const ownerName = String(formData.get("ownerName") || "").trim() || null;
  const reviewerName = String(formData.get("reviewerName") || "").trim() || null;
  const note = String(formData.get("note") || "").trim() || null;
  const nextStatus = resolveAlertStatusIntent(intent);
  const workflowIntent = resolveAlertWorkflowIntent(intent);
  const redirectUrl = new URL(request.url);
  const savedFilters = resolveAlertFilters(
    new URLSearchParams({
      alertType: String(formData.get("filterAlertType") || ""),
      entityType: String(formData.get("filterEntityType") || ""),
      queue: String(formData.get("filterQueue") || ""),
      search: String(formData.get("filterSearch") || ""),
      severity: String(formData.get("filterSeverity") || ""),
    }),
  );

  if (intent === "save_view") {
    try {
      await saveAlertSavedView({
        shopDomain: session.shop,
        name: savedViewName,
        filters: savedFilters,
        createdByLabel: savedViewCreatedByLabel,
        description: savedViewDescription,
        visibility: savedViewVisibility,
      });
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Saved view update failed.",
        status: "error",
      };
    }

    return redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  if (intent === "delete_saved_view") {
    try {
      await deleteAlertSavedView({
        shopDomain: session.shop,
        savedViewId,
      });
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Saved view delete failed.",
        status: "error",
      };
    }

    return redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  if (workflowIntent && (threadId || selectedThreadIds.length > 0)) {
    try {
      const workflowArgs = {
        markReviewed: workflowIntent === "mark_reviewed",
        note,
        ownerName: workflowIntent === "assign_owner" ? ownerName : undefined,
        reviewerName:
          workflowIntent === "assign_reviewer" || workflowIntent === "mark_reviewed" ? reviewerName : undefined,
        shopDomain: session.shop,
      };

      if (selectedThreadIds.length > 0) {
        await updateAlertThreadsWorkflow({
          ...workflowArgs,
          threadIds: selectedThreadIds,
        });
      } else {
        await updateAlertThreadWorkflow({
          ...workflowArgs,
          threadId,
        });
      }
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Thread workflow update failed.",
        status: "error",
      };
    }

    return redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  if (!nextStatus || (!alertId && !threadId && selectedAlertIds.length === 0 && selectedThreadIds.length === 0)) {
    return {
      message: "Unsupported alert action.",
      status: "error",
    };
  }

  try {
    if (selectedThreadIds.length > 0) {
      await transitionAlertThreadsStatus({
        shopDomain: session.shop,
        threadIds: selectedThreadIds,
        nextStatus,
      });
    } else if (selectedAlertIds.length > 0) {
      await transitionAlertsStatus({
        shopDomain: session.shop,
        alertIds: selectedAlertIds,
        nextStatus,
      });
    } else if (threadId) {
      await transitionAlertThreadStatus({
        shopDomain: session.shop,
        threadId,
        nextStatus,
      });
    } else {
      await transitionAlertStatus({
        shopDomain: session.shop,
        alertId,
        nextStatus,
      });
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Alert action failed.",
      status: "error",
    };
  }

  return redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
};

export default function AlertsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as AlertsActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const showActiveQueue = data.filters.queue !== "CLOSED";
  const showClosedQueue = data.filters.queue !== "ACTIVE";
  const sharedSavedViews = data.savedViews.filter((savedView) => savedView.visibility === "SHARED");
  const privateSavedViews = data.savedViews.filter((savedView) => savedView.visibility === "PRIVATE");

  return (
    <s-page heading="Alerts">
      {actionData ? (
        <s-section heading={actionData.status === "success" ? "Latest alert update" : "Alert action issue"}>
          <s-paragraph>
            <strong>{actionData.message}</strong>
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Alert queue overview">
        <s-paragraph>
          Open threads: <strong>{data.openThreadsCount}</strong> · Critical active alerts:{" "}
          <strong>{data.criticalAlertsCount}</strong>
        </s-paragraph>
        <s-paragraph>
          当前这页用于运营处理 alert，Dashboard 首页只显示 Top 5，这里会展示更完整的 active / closed 队列。
        </s-paragraph>
        <s-paragraph>
          当前队列视图：<strong>{data.filters.queue}</strong>
          {data.filters.alertType !== "ALL" ? (
            <>
              {" "}· Alert type: <strong>{data.filters.alertType}</strong>
            </>
          ) : null}
        </s-paragraph>
      </s-section>

      <s-section heading="Filters">
        <Form method="get" style={{ display: "grid", gap: "0.75rem", maxWidth: "48rem" }}>
          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Queue</span>
              <select
                name="queue"
                defaultValue={data.filters.queue}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              >
                <option value="ALL">All queues</option>
                <option value="ACTIVE">Active only</option>
                <option value="CLOSED">Closed only</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Severity</span>
              <select
                name="severity"
                defaultValue={data.filters.severity}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              >
                <option value="ALL">All severities</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Alert type</span>
              <select
                name="alertType"
                defaultValue={data.filters.alertType}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              >
                <option value="ALL">All alert types</option>
                {data.availableAlertTypes.map((alertType) => (
                  <option key={alertType} value={alertType}>
                    {alertType}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Entity type</span>
              <select
                name="entityType"
                defaultValue={data.filters.entityType}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              >
                <option value="ALL">All entities</option>
                {data.availableEntityTypes.map((entityType) => (
                  <option key={entityType} value={entityType}>
                    {entityType}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Search</span>
              <input
                type="text"
                name="search"
                defaultValue={data.filters.search}
                placeholder="title / alert type / entity"
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
                width: "fit-content",
              }}
            >
              Apply filters
            </button>
            <s-link href="/app/alerts">Clear filters</s-link>
          </div>
        </Form>
      </s-section>

      <s-section heading="Saved views">
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
            <input type="hidden" name="intent" value="save_view" />
            <input type="hidden" name="filterQueue" value={data.filters.queue} />
            <input type="hidden" name="filterSeverity" value={data.filters.severity} />
            <input type="hidden" name="filterAlertType" value={data.filters.alertType} />
            <input type="hidden" name="filterEntityType" value={data.filters.entityType} />
            <input type="hidden" name="filterSearch" value={data.filters.search} />
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Save current filter set</span>
              <input
                type="text"
                name="savedViewName"
                placeholder="e.g. Low-margin active SKUs"
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>
            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Visibility</span>
                <select
                  name="savedViewVisibility"
                  defaultValue="PRIVATE"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                >
                  <option value="PRIVATE">Private workspace</option>
                  <option value="SHARED">Shared team playbook</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Created by label</span>
                <input
                  type="text"
                  name="savedViewCreatedByLabel"
                  placeholder="Defaults to Merchant admin"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>
            </div>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Description</span>
              <textarea
                name="savedViewDescription"
                rows={2}
                placeholder="What this view is for, and when the team should open it"
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>
            <s-paragraph>
              Private vs shared is currently shop-level workflow metadata. It helps the team organize views now, and we can
              enforce true per-user access later when team identity lands.
            </s-paragraph>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
                Save this view
              </button>
            </div>
          </Form>

          {data.savedViews.length > 0 ? (
            <div style={{ display: "grid", gap: "1rem" }}>
              {[
                {
                  description: "Team playbooks that multiple operators can reuse.",
                  empty: "No shared team playbooks yet.",
                  heading: "Shared views",
                  items: sharedSavedViews,
                },
                {
                  description: "Personal or temporary workflows kept inside this shop workspace.",
                  empty: "No private workspace views yet.",
                  heading: "Private views",
                  items: privateSavedViews,
                },
              ].map((section) => (
                <div key={section.heading} style={{ display: "grid", gap: "0.75rem" }}>
                  <div>
                    <strong>{section.heading}</strong>
                    <div style={{ color: "#4b5563", marginTop: "0.2rem" }}>{section.description}</div>
                  </div>
                  {section.items.length > 0 ? (
                    section.items.map((savedView) => (
                      <s-box key={savedView.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                        <strong>{savedView.name}</strong>
                        <div>
                          Visibility: {savedView.visibility} · Created by: {savedView.createdByLabel || "Merchant admin"}
                        </div>
                        <div>
                          Queue: {savedView.queue} · Severity: {savedView.severity} · Alert type: {savedView.alertType}
                        </div>
                        <div>
                          Entity: {savedView.entityType} · Search: {savedView.search || "None"}
                        </div>
                        <div>Description: {savedView.description || "None"}</div>
                        <div>Updated: {formatDate(savedView.updatedAt)}</div>
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                          <s-link href={savedView.href}>Open view</s-link>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete_saved_view" />
                            <input type="hidden" name="savedViewId" value={savedView.id} />
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
                              Delete view
                            </button>
                          </Form>
                        </div>
                      </s-box>
                    ))
                  ) : (
                    <s-paragraph>{section.empty}</s-paragraph>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <s-paragraph>No saved views yet.</s-paragraph>
          )}
        </div>
      </s-section>

      <s-section heading="Open threads">
        {!showActiveQueue ? (
          <s-paragraph>Open thread queue is hidden by the current filter.</s-paragraph>
        ) : data.activeThreads.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <Form id="thread-batch-form" method="post" style={{ display: "grid", gap: "0.75rem" }}>
              <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", maxWidth: "48rem" }}>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>Owner</span>
                  <input
                    type="text"
                    name="ownerName"
                    placeholder="e.g. David"
                    style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>Reviewer</span>
                  <input
                    type="text"
                    name="reviewerName"
                    placeholder="e.g. Ops lead"
                    style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                  />
                </label>
                <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>
                  <span>Workflow note</span>
                  <textarea
                    name="note"
                    rows={2}
                    placeholder="Optional ownership or review note"
                    style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
                  Mark selected threads read
                </button>
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
                    background: "#0f766e",
                    color: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Resolve selected threads
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="ignore"
                  disabled={isSubmitting}
                  style={{
                    appearance: "none",
                    border: "1px solid #b45309",
                    borderRadius: "999px",
                    padding: "0.55rem 0.9rem",
                    background: "#ffffff",
                    color: "#b45309",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Ignore selected threads
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="assign_owner"
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
                  Assign owner
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="assign_reviewer"
                  disabled={isSubmitting}
                  style={{
                    appearance: "none",
                    border: "1px solid #4f46e5",
                    borderRadius: "999px",
                    padding: "0.55rem 0.9rem",
                    background: "#ffffff",
                    color: "#4f46e5",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Assign reviewer
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="mark_reviewed"
                  disabled={isSubmitting}
                  style={{
                    appearance: "none",
                    border: "1px solid #7c3aed",
                    borderRadius: "999px",
                    padding: "0.55rem 0.9rem",
                    background: "#ffffff",
                    color: "#7c3aed",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Mark reviewed
                </button>
              </div>
            </Form>
            {data.activeThreads.map((thread) => (
              <s-box
                key={thread.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input type="checkbox" name="selectedThreadIds" value={thread.id} form="thread-batch-form" />
                  <span>Select thread for batch action</span>
                </label>
                <strong>{thread.alertType}</strong>
                <div>
                  Scope: {thread.entityType} / {thread.entityKey}
                </div>
                <div>
                  Active alerts in thread: {thread.alertCount} · Critical alerts: {thread.criticalCount}
                </div>
                <div>Last detected: {formatDate(thread.lastDetectedAt)}</div>
                <div>
                  Owner: {thread.ownerName || "Unassigned"} · Reviewer: {thread.reviewerName || "Unassigned"}
                </div>
                <div>
                  Owner assigned: {formatDate(thread.ownerAssignedAt)} · Reviewed: {formatDate(thread.reviewedAt)}
                </div>
                <div>Workflow note: {thread.workflowNote || "None"}</div>
                {thread.latestAlert ? (
                  <div style={{ marginTop: "0.5rem" }}>
                    Latest hit: {thread.latestAlert.title} · {thread.latestAlert.severity}
                  </div>
                ) : null}
                {thread.latestAlert?.brief ? (
                  <div style={{ marginTop: "0.35rem", color: "#374151" }}>
                    Next action: {thread.latestAlert.brief.primaryAction}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="mark_read" />
                    <input type="hidden" name="threadId" value={thread.id} />
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
                      Mark thread read
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="resolve" />
                    <input type="hidden" name="threadId" value={thread.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #0f766e",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#0f766e",
                        color: "#ffffff",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Resolve thread
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="ignore" />
                    <input type="hidden" name="threadId" value={thread.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #b45309",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#ffffff",
                        color: "#b45309",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Ignore thread
                    </button>
                  </Form>
                  {thread.latestAlert ? <s-link href={`/app/alerts/${thread.latestAlert.id}`}>Open latest alert</s-link> : null}
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No open threads match the current filters.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Active alerts">
        {!showActiveQueue ? (
          <s-paragraph>Active alert queue is hidden by the current filter.</s-paragraph>
        ) : data.activeAlerts.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <Form id="active-alert-batch-form" method="post" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
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
                Mark selected alerts read
              </button>
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
                  background: "#0f766e",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Resolve selected alerts
              </button>
              <button
                type="submit"
                name="intent"
                value="ignore"
                disabled={isSubmitting}
                style={{
                  appearance: "none",
                  border: "1px solid #b45309",
                  borderRadius: "999px",
                  padding: "0.55rem 0.9rem",
                  background: "#ffffff",
                  color: "#b45309",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Ignore selected alerts
              </button>
            </Form>
            {data.activeAlerts.map((alert) => (
              <s-box
                key={alert.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input type="checkbox" name="selectedAlertIds" value={alert.id} form="active-alert-batch-form" />
                  <span>Select alert for batch action</span>
                </label>
                <strong>{alert.title}</strong>
                <div>Status: {alert.status} · Severity: {alert.severity}</div>
                <div>
                  Scope: {alert.entityType} / {alert.entityKey}
                </div>
                <div>
                  Impact: {formatCurrency(alert.impactAmount, alert.currencyCode || data.currencyCode)}
                </div>
                <div>
                  Detected: {formatDate(alert.detectedForDate)} · Confidence: {alert.confidenceLevel} · Completeness:{" "}
                  {alert.completenessLevel}
                </div>
                <div style={{ marginTop: "0.35rem", color: "#374151" }}>{alert.brief.summary}</div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="mark_read" />
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting || alert.status === "READ"}
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
                    <input type="hidden" name="intent" value="resolve" />
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #0f766e",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#0f766e",
                        color: "#ffffff",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Resolve
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="ignore" />
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #b45309",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#ffffff",
                        color: "#b45309",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Ignore
                    </button>
                  </Form>
                  <s-link href={`/app/alerts/${alert.id}`}>Open detail</s-link>
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No active alerts right now.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Recently closed alerts">
        {!showClosedQueue ? (
          <s-paragraph>Closed alert queue is hidden by the current filter.</s-paragraph>
        ) : data.recentClosedAlerts.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <Form id="closed-alert-batch-form" method="post" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="submit"
                name="intent"
                value="reopen"
                disabled={isSubmitting}
                style={{
                  appearance: "none",
                  border: "1px solid #7c3aed",
                  borderRadius: "999px",
                  padding: "0.55rem 0.9rem",
                  background: "#ffffff",
                  color: "#7c3aed",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reopen selected alerts
              </button>
            </Form>
            {data.recentClosedAlerts.map((alert) => (
              <s-box
                key={alert.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input type="checkbox" name="selectedAlertIds" value={alert.id} form="closed-alert-batch-form" />
                  <span>Select alert for batch reopen</span>
                </label>
                <strong>{alert.title}</strong>
                <div>Status: {alert.status} · Severity: {alert.severity}</div>
                <div>
                  Scope: {alert.entityType} / {alert.entityKey}
                </div>
                <div>
                  Impact: {formatCurrency(alert.impactAmount, alert.currencyCode || data.currencyCode)}
                </div>
                <div>Updated: {formatDate(alert.createdAt)}</div>
                <div style={{ marginTop: "0.35rem", color: "#374151" }}>{alert.brief.summary}</div>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="reopen" />
                    <input type="hidden" name="alertId" value={alert.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        appearance: "none",
                        border: "1px solid #7c3aed",
                        borderRadius: "999px",
                        padding: "0.55rem 0.9rem",
                        background: "#ffffff",
                        color: "#7c3aed",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Reopen
                    </button>
                  </Form>
                  <s-link href={`/app/alerts/${alert.id}`}>Open detail</s-link>
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No recently closed alerts yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
