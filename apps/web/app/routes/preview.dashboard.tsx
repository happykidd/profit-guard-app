import { Card, Grid, Metric, PreviewShell } from "../components/preview-shell";

export default function PreviewDashboardRoute() {
  return (
    <PreviewShell
      title="Daily Margin Command Center"
      subtitle="See profit health, completeness, and the highest-priority changes before you commit marketing or pricing moves."
      section="Dashboard"
      actions={
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontWeight: 700 }}>
            Health 82
          </span>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
            Coverage High
          </span>
        </div>
      }
    >
      <Grid>
        <Card tone="accent">
          <Metric label="Yesterday gross profit" value="$8,420" hint="+12.4% vs prior day" tone="#115e59" />
        </Card>
        <Card>
          <Metric label="Alert impact at risk" value="$1,340" hint="4 active issues ranked by severity" tone="#b91c1c" />
        </Card>
        <Card>
          <Metric label="Data completeness" value="94%" hint="Order coverage 100%, cost coverage 89%" tone="#1d4ed8" />
        </Card>
      </Grid>

      <div style={{ height: 18 }} />

      <Grid columns="1.25fr 0.75fr">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 24 }}>Top alerts</h2>
            <span style={{ color: "#64748b", fontWeight: 600 }}>Ranked by impact</span>
          </div>
          {[
            ["Low margin spike", "Shop margin dropped to 14.8% after refund and discount mix shifted.", "$760 impact"],
            ["Incomplete cost coverage", "42 variants still rely on fallback rules and need direct costs.", "$410 confidence gap"],
            ["Refund rate elevated", "Refund share reached 8.1% on the last 24-hour cohort.", "$170 impact"],
          ].map(([title, body, impact]) => (
            <div
              key={title}
              style={{
                display: "grid",
                gap: 6,
                padding: "16px 0",
                borderTop: "1px solid rgba(226,232,240,0.8)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <strong style={{ fontSize: 18 }}>{title}</strong>
                <span style={{ color: "#991b1b", fontWeight: 700 }}>{impact}</span>
              </div>
              <p style={{ margin: 0, color: "#475569" }}>{body}</p>
            </div>
          ))}
        </Card>

        <Card tone="muted">
          <h2 style={{ marginTop: 0, fontSize: 24 }}>Operational snapshot</h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#334155" }}>
            <li>Latest rebuild completed at 07:42</li>
            <li>Starter trial active with billing return synced</li>
            <li>2 recent reports exported this week</li>
            <li>Webhook delivery health is green</li>
          </ul>
        </Card>
      </Grid>
    </PreviewShell>
  );
}
