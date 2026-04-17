import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getFeedbackCenterOverview } from "../services/feedback-center.server";

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
  return getFeedbackCenterOverview(session.shop);
};

export default function FeedbackCenterPage() {
  const data = useLoaderData<typeof loader>();

  if (!data) {
    return (
      <s-page heading="Review & Feedback">
        <s-section heading="Feedback center">
          <s-paragraph>Shop record not found.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Review & Feedback">
      <s-section heading="Value signals">
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Useful feedback</strong>
            <div>{data.counts.usefulFeedbackCount}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Not useful feedback</strong>
            <div>{data.counts.notUsefulFeedbackCount}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Resolved alerts</strong>
            <div>{data.counts.resolvedAlertCount}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Active alerts</strong>
            <div>{data.counts.activeAlertCount}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Closed alerts</strong>
            <div>{data.counts.closedAlertCount}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Daily report streak</strong>
            <div>{data.reviewReadiness.consecutiveDailyReportDays}</div>
          </s-box>
        </div>
      </s-section>

      <s-section heading="Review request readiness">
        <s-banner tone={data.reviewReadiness.ready ? "success" : "info"}>
          {data.reviewReadiness.recommendedCopy}
        </s-banner>
        <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
          <div>
            <strong>Ready now:</strong> {data.reviewReadiness.ready ? "Yes" : "No"}
          </div>
          <div>
            <strong>Active triggers</strong>
            {data.reviewReadiness.triggers.length > 0 ? (
              <ul style={{ margin: "0.5rem 0 0", paddingInlineStart: "1.25rem" }}>
                {data.reviewReadiness.triggers.map((trigger) => (
                  <li key={trigger}>{trigger}</li>
                ))}
              </ul>
            ) : (
              <s-paragraph>No review trigger has fired yet.</s-paragraph>
            )}
          </div>
          <div>
            <strong>Blocked reasons</strong>
            {data.reviewReadiness.blockedReasons.length > 0 ? (
              <ul style={{ margin: "0.5rem 0 0", paddingInlineStart: "1.25rem" }}>
                {data.reviewReadiness.blockedReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <s-paragraph>No blocking reasons remain.</s-paragraph>
            )}
          </div>
          <div>
            <strong>Next milestones</strong>
            <ul style={{ margin: "0.5rem 0 0", paddingInlineStart: "1.25rem" }}>
              {data.reviewReadiness.nextMilestones.map((milestone) => (
                <li key={milestone}>{milestone}</li>
              ))}
            </ul>
          </div>
        </div>
      </s-section>

      <s-section heading="Launch readiness tracker">
        <s-banner tone={data.launchReadiness.metCount === data.launchReadiness.totalCount ? "success" : "warning"}>
          {data.launchReadiness.metCount} / {data.launchReadiness.totalCount} tracked PRD launch goals are currently met in this workspace.
        </s-banner>
        <s-paragraph>
          These are workspace-side proxy metrics against the PRD launch criteria. They help us see what still needs real merchant validation before public launch.
        </s-paragraph>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
          {data.launchReadiness.goals.map((goal) => (
            <s-box key={goal.label} padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <strong>{goal.label}</strong>
              <div>
                Current: {goal.current} · Target: {goal.target}
              </div>
              <div>{goal.met ? "Met" : "Not met yet"}</div>
            </s-box>
          ))}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <strong>Current blockers</strong>
          {data.launchReadiness.blockers.length > 0 ? (
            <ul style={{ margin: "0.5rem 0 0", paddingInlineStart: "1.25rem" }}>
              {data.launchReadiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : (
            <s-paragraph>No infrastructure blockers are currently flagged by the workspace telemetry.</s-paragraph>
          )}
        </div>
      </s-section>

      <s-section heading="Recent feedback history">
        {data.recentFeedbacks.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentFeedbacks.map((feedback) => (
              <s-box key={feedback.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{feedback.alert.title}</strong>
                <div>{feedback.alert.alertType} · {feedback.alert.entityKey} · {feedback.alert.status}</div>
                <div>Feedback: {feedback.feedback}</div>
                <div>At: {formatDate(feedback.createdAt)}</div>
                <div>Note: {feedback.note ?? "No note"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No alert feedback has been recorded yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Recently resolved alerts">
        {data.recentResolvedAlerts.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentResolvedAlerts.map((alert) => (
              <s-box key={`${alert.alertType}:${alert.updatedAt}`} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{alert.title}</strong>
                <div>{alert.alertType} · {alert.entityKey}</div>
                <div>Detected: {formatDate(alert.detectedForDate)}</div>
                <div>Resolved: {formatDate(alert.updatedAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No resolved alerts yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Daily summary touch points">
        {data.recentDailyReports.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentDailyReports.map((report) => (
              <s-box key={report.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{report.reportType}</strong>
                <div>Window end: {formatDate(report.periodEnd)}</div>
                <div>Generated: {formatDate(report.createdAt)}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No daily reports generated yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
