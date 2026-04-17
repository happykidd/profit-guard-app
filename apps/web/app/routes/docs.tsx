import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { getPublicSiteConfig } from "../lib/public-site.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return getPublicSiteConfig(request);
};

export default function DocsRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <main
      style={{
        maxWidth: "860px",
        margin: "0 auto",
        padding: "48px 20px 72px",
        fontFamily: "Inter, sans-serif",
        lineHeight: 1.6,
        color: "#1f2937",
      }}
    >
      <p style={{ marginBottom: 8, color: "#0f766e", fontWeight: 700 }}>Documentation</p>
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, marginBottom: 12 }}>
        Profit Guard Setup Overview
      </h1>
      <p style={{ marginBottom: 24, color: "#4b5563" }}>
        Merchants typically install the app, allow sync to complete, add costs, and then
        review alerts and reports from the embedded workspace.
      </p>

      <ol style={{ paddingLeft: 18 }}>
        <li>Install Profit Guard from Shopify Admin.</li>
        <li>Wait for the first bootstrap sync and backfill to finish.</li>
        <li>Add direct costs or import CSV cost data.</li>
        <li>Review Dashboard, Alerts, Costs, Reports, and Billing.</li>
      </ol>

      <p style={{ marginTop: 24 }}>
        Need implementation help? Visit <Link to="/support">Support</Link> or email{" "}
        <a href={`mailto:${data.supportEmail}`}>{data.supportEmail}</a>.
      </p>
    </main>
  );
}
