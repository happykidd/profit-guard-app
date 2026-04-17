import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { getPublicSiteConfig } from "../lib/public-site.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return getPublicSiteConfig(request);
};

const faqItems = [
  {
    question: "What does Profit Guard do?",
    answer:
      "Profit Guard helps merchants detect margin leaks, review priority alerts, and move from diagnosis to action faster with daily profit monitoring.",
  },
  {
    question: "How does Profit Guard estimate profitability?",
    answer:
      "The app combines Shopify order and product data with direct costs, imported costs, and fallback cost rules to build daily metrics, completeness signals, and alert summaries.",
  },
  {
    question: "Do I need to load costs before I see value?",
    answer:
      "No. Merchants can still review platform and operating signals first, then improve profit accuracy over time by adding direct costs or fallback rules.",
  },
  {
    question: "What if my cost data is incomplete?",
    answer:
      "Profit Guard shows completeness and health signals so merchants can see where missing cost coverage may affect profit interpretation.",
  },
  {
    question: "How do I get support?",
    answer:
      "Email support with your store domain and a short description of the issue so we can investigate quickly.",
  },
];

export default function FaqRoute() {
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
      <p style={{ marginBottom: 8, color: "#0f766e", fontWeight: 700 }}>FAQ</p>
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, marginBottom: 12 }}>
        Profit Guard Frequently Asked Questions
      </h1>
      <p style={{ marginBottom: 24, color: "#4b5563" }}>
        These are the most common questions merchants ask during setup and early usage.
      </p>

      <div style={{ display: "grid", gap: 20 }}>
        {faqItems.map((item) => (
          <section
            key={item.question}
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 16,
              padding: 20,
              background: "#fff",
            }}
          >
            <h2 style={{ marginTop: 0 }}>{item.question}</h2>
            <p style={{ marginBottom: 0 }}>{item.answer}</p>
          </section>
        ))}
      </div>

      <p style={{ marginTop: 24, color: "#6b7280" }}>
        Need more help? Email <a href={`mailto:${data.supportEmail}`}>{data.supportEmail}</a>.
      </p>
    </main>
  );
}
