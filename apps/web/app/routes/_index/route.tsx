import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, Form, useLoaderData } from "react-router";

import { getPublicSiteConfig } from "../../lib/public-site.server";
import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return {
    showForm: Boolean(login),
    site: getPublicSiteConfig(request),
  };
};

export default function App() {
  const { showForm, site } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.kicker}>Profit Guard</p>
          <h1 className={styles.heading}>Daily profit alerts and next-step actions for Shopify teams.</h1>
          <p className={styles.text}>
            Spot margin leaks early, understand what changed, and work through the most
            important profit issues before they grow.
          </p>
          <div className={styles.linkRow}>
            <Link className={styles.linkPill} to="/pricing">
              Pricing
            </Link>
            <Link className={styles.linkPill} to="/faq">
              FAQ
            </Link>
            <Link className={styles.linkPill} to="/privacy">
              Privacy policy
            </Link>
            <Link className={styles.linkPill} to="/support">
              Support
            </Link>
          </div>
        </div>

        {showForm && (
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>Open your store workspace</h2>
            <p className={styles.cardText}>
              Install or open Profit Guard from Shopify Admin to view health score,
              alerts, reports, billing, and cost coverage.
            </p>
            <Form className={styles.form} method="post" action="/auth/login">
              <label className={styles.label}>
                <span>Shop domain</span>
                <input className={styles.input} type="text" name="shop" />
                <span>e.g. my-shop-domain.myshopify.com</span>
              </label>
              <button className={styles.button} type="submit">
                Open app
              </button>
            </Form>
            <p className={styles.supportText}>
              Support: <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>
            </p>
          </div>
        )}

        <ul className={styles.list}>
          <li>
            <strong>Daily monitoring.</strong> Track profit health, completeness, and
            alert-worthy changes without staring at dashboards all day.
          </li>
          <li>
            <strong>Action-oriented alerts.</strong> Review ranked issues with impact,
            context, ownership, and playbooks inside one alert center.
          </li>
          <li>
            <strong>Cost coverage.</strong> Combine direct SKU costs, CSV imports, and
            fallback rules so margin signals become more trustworthy over time.
          </li>
        </ul>
      </div>
    </div>
  );
}
