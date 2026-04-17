import type { CSSProperties, PropsWithChildren, ReactNode } from "react";

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(20,184,166,0.18), transparent 22rem), linear-gradient(180deg, #f4fbfa 0%, #ffffff 38%, #eef6ff 100%)",
  color: "#0f172a",
  fontFamily: "Inter, sans-serif",
  padding: "40px 48px 56px",
  boxSizing: "border-box",
};

const panelStyle: CSSProperties = {
  maxWidth: "1480px",
  margin: "0 auto",
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 28,
  boxShadow: "0 28px 80px rgba(15,23,42,0.12)",
  overflow: "hidden",
};

const navStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "18px 24px",
  borderBottom: "1px solid rgba(226,232,240,0.9)",
  background: "rgba(248,250,252,0.92)",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(15,118,110,0.08)",
  color: "#115e59",
  fontWeight: 700,
  fontSize: 14,
};

export function PreviewShell({
  title,
  subtitle,
  section,
  actions,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  section: string;
  actions?: ReactNode;
}>) {
  return (
    <main style={pageStyle}>
      <div style={panelStyle}>
        <header style={navStyle}>
          <div>
            <div style={badgeStyle}>Profit Guard</div>
            <h1 style={{ margin: "18px 0 6px", fontSize: 42, lineHeight: 1.05 }}>{title}</h1>
            <p style={{ margin: 0, color: "#475569", fontSize: 18 }}>{subtitle}</p>
          </div>
          <div style={{ display: "grid", gap: 12, justifyItems: "end" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "10px 14px",
                borderRadius: 999,
                background: "#0f766e",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {section}
            </span>
            {actions}
          </div>
        </header>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </main>
  );
}

export function Grid({ children, columns = "repeat(3, minmax(0, 1fr))" }: PropsWithChildren<{ columns?: string }>) {
  return (
    <div
      style={{
        display: "grid",
        gap: 18,
        gridTemplateColumns: columns,
      }}
    >
      {children}
    </div>
  );
}

export function Card({ children, tone = "default" }: PropsWithChildren<{ tone?: "default" | "accent" | "muted" }>) {
  const background =
    tone === "accent" ? "linear-gradient(180deg, #ecfeff 0%, #ffffff 100%)" : tone === "muted" ? "#f8fafc" : "#ffffff";
  return (
    <section
      style={{
        border: "1px solid rgba(148,163,184,0.22)",
        borderRadius: 22,
        padding: 20,
        background,
        boxShadow: "0 14px 32px rgba(15,23,42,0.05)",
      }}
    >
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "#0f172a",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div>
      <p style={{ margin: 0, color: "#64748b", fontSize: 14, fontWeight: 600 }}>{label}</p>
      <p style={{ margin: "8px 0 6px", fontSize: 34, fontWeight: 800, color: tone }}>{value}</p>
      <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>{hint}</p>
    </div>
  );
}
