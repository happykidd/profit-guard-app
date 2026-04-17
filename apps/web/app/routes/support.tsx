import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { buildPublicUrl, getPublicSiteConfig } from "../lib/public-site.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const site = getPublicSiteConfig(request);

  return {
    ...site,
    faqUrl: buildPublicUrl(site.baseUrl, "/faq"),
    pricingUrl: buildPublicUrl(site.baseUrl, "/pricing"),
    privacyUrl: buildPublicUrl(site.baseUrl, "/privacy"),
  };
};

export default function SupportRoute() {
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
      <p style={{ marginBottom: 8, color: "#0f766e", fontWeight: 700 }}>Support</p>
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, marginBottom: 12 }}>
        Get Help With Profit Guard
      </h1>
      <p style={{ marginBottom: 24, color: "#4b5563" }}>
        Use this page for installation questions, data sync issues, billing follow-up,
        and help understanding alerts, reports, and cost coverage.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>Best contact channel</h2>
        <p>
          Email us at <a href={`mailto:${data.supportEmail}`}>{data.supportEmail}</a>.
          Include your store domain, a short description of the issue, and screenshots if
          they help explain the problem.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>What to include in your request</h2>
        <ul>
          <li>your Shopify store domain,</li>
          <li>the page or workflow where the issue happened,</li>
          <li>the approximate time of the issue,</li>
          <li>screenshots or short reproduction steps.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Common support topics</h2>
        <ul>
          <li>first-time store sync and backfill status,</li>
          <li>missing costs and CSV import questions,</li>
          <li>alert interpretation and workflow handling,</li>
          <li>billing state and subscription return flow.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Self-serve links</h2>
        <ul>
          <li>
            <Link to="/faq">FAQ</Link>
          </li>
          <li>
            <Link to="/pricing">Pricing</Link>
          </li>
          <li>
            <Link to="/privacy">Privacy policy</Link>
          </li>
        </ul>
      </section>

      <p style={{ color: "#6b7280" }}>
        Absolute URLs: <a href={data.faqUrl}>FAQ</a> · <a href={data.pricingUrl}>Pricing</a> ·{" "}
        <a href={data.privacyUrl}>Privacy</a>
      </p>
    </main>
  );
}
