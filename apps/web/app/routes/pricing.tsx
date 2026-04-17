import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { BILLING_PLAN_DETAILS, BILLING_TRIAL_DAYS } from "../services/billing-config.server";
import { getPublicSiteConfig } from "../lib/public-site.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const site = getPublicSiteConfig(request);

  return {
    ...site,
    trialDays: BILLING_TRIAL_DAYS,
    plans: BILLING_PLAN_DETAILS,
  };
};

export default function PricingRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <main
      style={{
        maxWidth: "960px",
        margin: "0 auto",
        padding: "48px 20px 72px",
        fontFamily: "Inter, sans-serif",
        lineHeight: 1.6,
        color: "#1f2937",
      }}
    >
      <p style={{ marginBottom: 8, color: "#0f766e", fontWeight: 700 }}>Pricing</p>
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, marginBottom: 12 }}>
        Profit Guard Plans
      </h1>
      <p style={{ marginBottom: 28, color: "#4b5563" }}>
        Billing is handled through Shopify Billing. Plans can include a{" "}
        {data.trialDays}-day trial where supported by the merchant installation flow.
      </p>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {data.plans.map((plan) => (
          <section
            key={plan.key}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 18,
              padding: 24,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>{plan.title}</h2>
            <p style={{ fontSize: "2rem", fontWeight: 700, margin: "0 0 8px" }}>
              {plan.currencyCode} {plan.price}
              <span style={{ fontSize: "1rem", fontWeight: 500, color: "#6b7280" }}>/30 days</span>
            </p>
            <p style={{ color: "#4b5563" }}>{plan.description}</p>
            <ul style={{ paddingLeft: 18 }}>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
