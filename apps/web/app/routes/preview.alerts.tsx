import { Card, Grid, PreviewShell } from "../components/preview-shell";

export default function PreviewAlertsRoute() {
  return (
    <PreviewShell
      title="Alert Center Workflow"
      subtitle="Move through new alerts with severity, playbooks, ownership, and clear next actions."
      section="Alerts"
      actions={
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
            4 open threads
          </span>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 }}>
            2 assigned
          </span>
        </div>
      }
    >
      <Grid columns="0.9fr 1.1fr">
        <Card>
          <h2 style={{ marginTop: 0, fontSize: 24 }}>Queues</h2>
          {[
            ["Open threads", "4 threads", "#0f766e"],
            ["Needs review", "2 threads", "#1d4ed8"],
            ["Resolved this week", "11 alerts", "#475569"],
          ].map(([label, value, color]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 0",
                borderTop: "1px solid rgba(226,232,240,0.85)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={{ color, fontWeight: 800 }}>{value}</span>
            </div>
          ))}
        </Card>

        <Card tone="accent">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div>
              <p style={{ margin: 0, color: "#0f766e", fontWeight: 700 }}>SHOP_LOW_MARGIN</p>
              <h2 style={{ margin: "8px 0", fontSize: 28 }}>Margin dropped after discount and refund mix changed</h2>
            </div>
            <span
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                background: "#fee2e2",
                color: "#991b1b",
                fontWeight: 800,
              }}
            >
              High
            </span>
          </div>
          <p style={{ color: "#475569" }}>
            Yesterday gross margin fell to 14.8%. Refund share and discount depth both moved
            above their recent baseline, creating a meaningful profit leak.
          </p>

          <Grid columns="repeat(3, minmax(0, 1fr))">
            {[
              ["Impact", "$760 at risk"],
              ["Confidence", "0.89"],
              ["Owner", "Ops lead"],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: 16, borderRadius: 18, background: "rgba(255,255,255,0.8)" }}>
                <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>{label}</p>
                <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 800 }}>{value}</p>
              </div>
            ))}
          </Grid>

          <div style={{ marginTop: 18, padding: 18, borderRadius: 20, background: "rgba(255,255,255,0.82)" }}>
            <h3 style={{ marginTop: 0 }}>Recommended next step</h3>
            <p style={{ marginBottom: 0 }}>
              Review yesterday’s top refunded SKUs, compare discount depth by channel, then
              rerun the daily rebuild after cost gaps are fixed.
            </p>
          </div>
        </Card>
      </Grid>
    </PreviewShell>
  );
}
