import { Card, Grid, PreviewShell } from "../components/preview-shell";

export default function PreviewCostsRoute() {
  return (
    <PreviewShell
      title="Cost Coverage Workspace"
      subtitle="Combine direct costs, imports, and fallback rules so every profit signal is easier to trust."
      section="Costs"
      actions={
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#dcfce7", color: "#166534", fontWeight: 700 }}>
            89% direct coverage
          </span>
          <span style={{ padding: "10px 14px", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontWeight: 700 }}>
            42 fallback variants
          </span>
        </div>
      }
    >
      <Grid columns="1fr 1fr">
        <Card>
          <h2 style={{ marginTop: 0, fontSize: 24 }}>Recent imports</h2>
          {[
            ["SKU direct cost CSV", "Imported 218 rows · 0 errors", "#166534"],
            ["Vendor fallback rules", "Imported 12 rules · 1 duplicate ignored", "#1d4ed8"],
            ["Product type defaults", "Updated 5 categories", "#0f766e"],
          ].map(([title, body, color]) => (
            <div
              key={title}
              style={{
                display: "grid",
                gap: 6,
                padding: "16px 0",
                borderTop: "1px solid rgba(226,232,240,0.85)",
              }}
            >
              <strong>{title}</strong>
              <span style={{ color }}>{body}</span>
            </div>
          ))}
        </Card>

        <Card tone="muted">
          <h2 style={{ marginTop: 0, fontSize: 24 }}>Coverage gaps to close</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>18 apparel variants still use product-type fallback</li>
            <li>14 accessories variants still use vendor fallback</li>
            <li>10 seasonal SKUs need manual overrides before next rebuild</li>
          </ul>
        </Card>
      </Grid>

      <div style={{ height: 18 }} />

      <Card tone="accent">
        <h2 style={{ marginTop: 0, fontSize: 24 }}>Fallback rule table</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr 1fr 1fr",
            gap: 12,
            color: "#334155",
            fontWeight: 600,
          }}
        >
          <span>Scope</span>
          <span>Match key</span>
          <span>Default cost rate</span>
          <span>Notes</span>
          {[
            ["product_type", "Outerwear", "32%", "Used while direct unit costs are incomplete"],
            ["vendor", "Core Supplier A", "28%", "Stable landed cost benchmark"],
            ["tag", "seasonal-drop", "35%", "Higher packaging and return risk"],
          ].flatMap((row) =>
            row.map((cell) => (
              <span
                key={`${row[0]}-${cell}`}
                style={{
                  padding: "14px 12px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.82)",
                  fontWeight: 500,
                }}
              >
                {cell}
              </span>
            )),
          )}
        </div>
      </Card>
    </PreviewShell>
  );
}
