import { Form, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  createAlertFeedback,
  getAlertDetail,
  resolveAlertFeedbackIntent,
  resolveAlertStatusIntent,
  resolveAlertWorkflowIntent,
  transitionAlertStatus,
  transitionAlertThreadStatus,
  updateAlertThreadWorkflow,
} from "../services/alerts.server";

type AlertDetailActionData = {
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

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const alertId = params.alertId;

  if (!alertId) {
    throw new Response("Alert not found", {
      status: 404,
    });
  }

  const detail = await getAlertDetail({
    shopDomain: session.shop,
    alertId,
  });

  if (!detail) {
    throw new Response("Alert not found", {
      status: 404,
    });
  }

  return detail;
};

export const action = async ({ params, request }: ActionFunctionArgs): Promise<AlertDetailActionData | Response> => {
  const { session } = await authenticate.admin(request);
  const alertId = params.alertId;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const note = String(formData.get("note") || "").trim() || null;
  const ownerName = String(formData.get("ownerName") || "").trim() || null;
  const reviewerName = String(formData.get("reviewerName") || "").trim() || null;

  if (!alertId) {
    return {
      message: "Alert not found.",
      status: "error",
    };
  }

  const nextStatus = resolveAlertStatusIntent(intent);
  const threadAction = String(formData.get("threadAction") || "").trim() === "true";
  if (nextStatus) {
    try {
      if (threadAction) {
        const threadId = String(formData.get("threadId") || "").trim();

        if (!threadId) {
          return {
            message: "Alert thread not found.",
            status: "error",
          };
        }

        await transitionAlertThreadStatus({
          shopDomain: session.shop,
          threadId,
          nextStatus,
          note,
        });
      } else {
        await transitionAlertStatus({
          shopDomain: session.shop,
          alertId,
          nextStatus,
          note,
        });
      }
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Alert status update failed.",
        status: "error",
      };
    }

    return redirect(`/app/alerts/${alertId}`);
  }

  const feedback = resolveAlertFeedbackIntent(intent);
  if (feedback) {
    try {
      await createAlertFeedback({
        shopDomain: session.shop,
        alertId,
        feedback,
        note,
      });
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Alert feedback save failed.",
        status: "error",
      };
    }

    return redirect(`/app/alerts/${alertId}`);
  }

  const workflowIntent = resolveAlertWorkflowIntent(intent);
  if (workflowIntent) {
    const threadId = String(formData.get("threadId") || "").trim();

    if (!threadId) {
      return {
        message: "Alert thread not found.",
        status: "error",
      };
    }

    try {
      await updateAlertThreadWorkflow({
        markReviewed: workflowIntent === "mark_reviewed",
        note,
        ownerName: workflowIntent === "assign_owner" ? ownerName : undefined,
        reviewerName:
          workflowIntent === "assign_reviewer" || workflowIntent === "mark_reviewed" ? reviewerName : undefined,
        shopDomain: session.shop,
        threadId,
      });
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : "Thread workflow update failed.",
        status: "error",
      };
    }

    return redirect(`/app/alerts/${alertId}`);
  }

  return {
    message: "Unsupported alert action.",
    status: "error",
  };
};

export default function AlertDetailPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as AlertDetailActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Alert detail">
      {actionData ? (
        <s-section heading={actionData.status === "success" ? "Latest alert update" : "Alert action issue"}>
          <s-paragraph>
            <strong>{actionData.message}</strong>
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Summary">
        <s-paragraph>
          <strong>{data.alert.title}</strong>
        </s-paragraph>
        <s-paragraph>{data.alert.brief.summary}</s-paragraph>
        <s-paragraph>
          Type: {data.alert.alertType} · Status: {data.alert.status} · Severity: {data.alert.severity}
        </s-paragraph>
        <s-paragraph>
          Scope: {data.alert.entityType} / {data.alert.entityKey}
        </s-paragraph>
        <s-paragraph>
          Impact: {formatCurrency(data.alert.impactAmount, data.currencyCode)} · Rank: {data.alert.rankScore || "Not available"}
        </s-paragraph>
        <s-paragraph>
          Confidence: {data.alert.confidenceLevel} · Completeness: {data.alert.completenessLevel}
        </s-paragraph>
        <s-paragraph>
          Detected: {formatDate(data.alert.detectedForDate)} · Expires: {formatDate(data.alert.expiresAt)}
        </s-paragraph>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <s-link href="/app/alerts">Back to alerts</s-link>
          <s-link href="/app">Back to dashboard</s-link>
        </div>
      </s-section>

      {data.thread ? (
        <s-section heading="Workflow">
          <s-paragraph>
            Owner: <strong>{data.thread.ownerName || "Unassigned"}</strong> · Reviewer:{" "}
            <strong>{data.thread.reviewerName || "Unassigned"}</strong>
          </s-paragraph>
          <s-paragraph>
            Owner assigned: {formatDate(data.thread.ownerAssignedAt)} · Reviewed: {formatDate(data.thread.reviewedAt)}
          </s-paragraph>
          <s-paragraph>Workflow note: {data.thread.workflowNote || "None"}</s-paragraph>
          <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
            <input type="hidden" name="threadId" value={data.thread.id} />
            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Owner</span>
                <input
                  type="text"
                  name="ownerName"
                  defaultValue={data.thread.ownerName || ""}
                  placeholder="Assign owner"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Reviewer</span>
                <input
                  type="text"
                  name="reviewerName"
                  defaultValue={data.thread.reviewerName || ""}
                  placeholder="Assign reviewer"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>
              <label style={{ display: "grid", gap: "0.35rem", gridColumn: "1 / -1" }}>
                <span>Workflow note</span>
                <textarea
                  name="note"
                  rows={3}
                  defaultValue={data.thread.workflowNote || ""}
                  placeholder="Why this thread is assigned or reviewed"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="submit"
                name="intent"
                value="assign_owner"
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
                }}
              >
                Save owner
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
                  padding: "0.65rem 1rem",
                  background: "#ffffff",
                  color: "#4f46e5",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Save reviewer
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
                  padding: "0.65rem 1rem",
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
        </s-section>
      ) : null}

      <s-section heading="AI explanation">
        <s-paragraph>{data.alert.explanation.narrative.summary}</s-paragraph>
        <s-paragraph>{data.alert.explanation.narrative.whyItMatters}</s-paragraph>
        <s-paragraph>
          <strong>Next question:</strong> {data.alert.explanation.narrative.nextQuestion}
        </s-paragraph>
        <s-paragraph>
          Generated with <strong>{data.alert.explanation.generator.provider}</strong> (
          {data.alert.explanation.generator.modelName}) ·{" "}
          {data.alert.explanation.generator.fallbackUsed ? "rules-first fallback" : "AI assisted"} ·{" "}
          {formatDate(data.alert.explanation.generator.generatedAt)}
        </s-paragraph>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {data.alert.explanation.narrative.recommendedActions.map((action) => (
            <s-paragraph key={action}>- {action}</s-paragraph>
          ))}
        </div>
      </s-section>

      <s-section heading="Recommended playbook">
        <s-paragraph>{data.alert.brief.whyItMatters}</s-paragraph>
        <s-paragraph>
          <strong>Primary action:</strong> {data.alert.brief.primaryAction}
        </s-paragraph>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
          {data.alert.brief.metrics.map((metric) => (
            <s-box key={metric.label} padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <strong>{metric.label}</strong>
              <div>{metric.value}</div>
            </s-box>
          ))}
        </div>
        <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
          {data.alert.brief.checks.map((check) => (
            <s-paragraph key={check}>- {check}</s-paragraph>
          ))}
        </div>
      </s-section>

      <s-section heading="Take action">
        <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Note</span>
            <textarea
              name="note"
              rows={3}
              placeholder="Optional note for your team"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="submit"
              name="intent"
              value="mark_read"
              disabled={isSubmitting || data.alert.status === "READ"}
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
              Mark read
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
                padding: "0.65rem 1rem",
                background: "#0f766e",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Resolve
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
                padding: "0.65rem 1rem",
                background: "#ffffff",
                color: "#b45309",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Ignore
            </button>
            <button
              type="submit"
              name="intent"
              value="reopen"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #7c3aed",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#ffffff",
                color: "#7c3aed",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reopen
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Feedback">
        <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Feedback note</span>
            <textarea
              name="note"
              rows={3}
              placeholder="What made this alert useful or noisy?"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="submit"
              name="intent"
              value="feedback_useful"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #0f766e",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#ffffff",
                color: "#0f766e",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Mark useful
            </button>
            <button
              type="submit"
              name="intent"
              value="feedback_not_useful"
              disabled={isSubmitting}
              style={{
                appearance: "none",
                border: "1px solid #b91c1c",
                borderRadius: "999px",
                padding: "0.65rem 1rem",
                background: "#ffffff",
                color: "#b91c1c",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Mark noisy
            </button>
          </div>
        </Form>
      </s-section>

      <s-section heading="Rule payload">
        <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(data.alert.rulePayload, null, 2)}
        </pre>
      </s-section>

      <s-section heading="Status history">
        {data.statusHistory.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.statusHistory.map((history) => (
              <s-box
                key={history.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>
                  {history.fromStatus || "None"} → {history.toStatus}
                </strong>
                <div>When: {formatDate(history.createdAt)}</div>
                <div>Actor: {history.actorType || "Unknown"}</div>
                <div>Note: {history.note || "None"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No status history yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Thread timeline">
        {data.thread ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-paragraph>
              Thread: <strong>{data.thread.entityType} / {data.thread.entityKey}</strong>
            </s-paragraph>
            <s-paragraph>
              Open: {data.thread.isOpen ? "Yes" : "No"} · Last detected: {formatDate(data.thread.lastDetectedAt)}
            </s-paragraph>
            {data.thread.alerts[0]?.brief ? (
              <s-paragraph>
                Thread next action: <strong>{data.thread.alerts[0].brief.primaryAction}</strong>
              </s-paragraph>
            ) : null}
            <Form method="post" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <input type="hidden" name="threadAction" value="true" />
              <input type="hidden" name="threadId" value={data.thread.id} />
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
                Mark thread read
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
                  background: "#ffffff",
                  color: "#0f766e",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Resolve thread
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
                Ignore thread
              </button>
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
                Reopen thread
              </button>
            </Form>
            {data.thread.alerts.map((threadAlert) => (
              <s-box
                key={threadAlert.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{threadAlert.title}</strong>
                <div>Status: {threadAlert.status}</div>
                <div>Detected: {formatDate(threadAlert.detectedForDate)}</div>
                <div style={{ marginTop: "0.35rem", color: "#374151" }}>{threadAlert.brief.summary}</div>
                <s-link href={`/app/alerts/${threadAlert.id}`}>Open this alert</s-link>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>This alert is not attached to a thread.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Feedback history">
        {data.feedbacks.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.feedbacks.map((feedback) => (
              <s-box
                key={feedback.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{feedback.feedback}</strong>
                <div>When: {formatDate(feedback.createdAt)}</div>
                <div>Actor: {feedback.actorType || "Unknown"}</div>
                <div>Note: {feedback.note || "None"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No feedback captured yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
