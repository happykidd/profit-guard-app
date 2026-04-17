import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { buildPublicUrl, getPublicSiteConfig } from "../lib/public-site.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const site = getPublicSiteConfig(request);

  return {
    ...site,
    faqUrl: buildPublicUrl(site.baseUrl, "/faq"),
    supportUrl: buildPublicUrl(site.baseUrl, "/support"),
  };
};

export default function PrivacyRoute() {
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
      <p style={{ marginBottom: 8, color: "#0f766e", fontWeight: 700 }}>Profit Guard</p>
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, marginBottom: 12 }}>Privacy Policy</h1>
      <p style={{ marginBottom: 24, color: "#4b5563" }}>
        This privacy policy explains what data Profit Guard processes for Shopify
        merchants, why it is processed, and how merchants can contact us with privacy
        questions.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>1. Data we process</h2>
        <p>
          Profit Guard processes store operational data that is required to calculate
          profit health, generate alerts, and prepare reports. This can include store
          identifiers, products, variants, orders, refunds, shipping-related amounts,
          manually entered cost data, and app usage metadata.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>2. Why we process data</h2>
        <p>We process merchant data to:</p>
        <ul>
          <li>sync Shopify store activity into the app,</li>
          <li>calculate profitability and completeness metrics,</li>
          <li>generate alert threads, reports, and operational summaries,</li>
          <li>support billing, support, and app reliability workflows.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>3. Data sharing</h2>
        <p>
          Profit Guard does not sell merchant data. Data may be processed by
          infrastructure providers that support hosting, storage, logging, or billing,
          but only for the purpose of running the app and supporting merchants.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>4. Retention and deletion</h2>
        <p>
          We retain merchant data only for as long as it is needed to provide the app,
          support historical reporting, meet legal obligations, and maintain service
          integrity. If the app is uninstalled, associated data can be deleted according
          to our retention policy and Shopify platform requirements.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>5. Merchant rights and requests</h2>
        <p>
          Merchants can contact us to request help with access, deletion, or privacy
          questions. We review requests as quickly as possible and coordinate responses
          with Shopify platform requirements where applicable.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Contact</h2>
        <p>
          Privacy questions can be sent to{" "}
          <a href={`mailto:${data.supportEmail}`}>{data.supportEmail}</a>.
        </p>
      </section>

      <p style={{ color: "#6b7280" }}>
        Helpful links: <Link to="/support">Support</Link> · <Link to="/faq">FAQ</Link> ·{" "}
        <a href={data.faqUrl}>Absolute FAQ URL</a> · <a href={data.supportUrl}>Absolute support URL</a>
      </p>
    </main>
  );
}
