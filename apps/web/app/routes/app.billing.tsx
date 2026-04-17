import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate, GROWTH_PLAN, STARTER_PLAN } from "../shopify.server";
import {
  BILLING_MODE,
  getBillingReturnUrl,
  getManagedPricingSelectionUrl,
  isManagedBillingMode,
} from "../services/billing-config.server";
import {
  getStoredBillingState,
  getBillingPlansForUi,
  listRecentBillingEvents,
  recordBillingRequest,
  syncBillingState,
} from "../services/billing.server";

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const billingState = await getStoredBillingState(session.shop);
  const url = new URL(request.url);
  const recentEvents = await listRecentBillingEvents({
    shopDomain: session.shop,
  });

  return {
    billingState: {
      ...billingState,
      trialEndsAt: billingState.trialEndsAt?.toISOString() ?? null,
    },
    billingReturnState:
      url.searchParams.get("billing_status") === "returned"
        ? "Shopify billing confirmation received."
        : null,
    billingMode: BILLING_MODE,
    isBillingTestMode: getBillingPlansForUi()[0]?.isTest ?? true,
    managedPricingUrl: isManagedBillingMode()
      ? getManagedPricingSelectionUrl(session.shop)
      : null,
    plans: getBillingPlansForUi(),
    recentEvents,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "refresh") {
    const billingCheck = await billing.check();
    await syncBillingState({
      shopDomain: session.shop,
      billingCheck,
    });
    return redirect("/app/billing");
  }

  if (intent !== "subscribe") {
    return redirect("/app/billing");
  }

  const plan = formData.get("plan");
  const normalizedPlan = typeof plan === "string" ? plan : STARTER_PLAN;
  const targetPlan: typeof STARTER_PLAN | typeof GROWTH_PLAN =
    normalizedPlan === GROWTH_PLAN ? GROWTH_PLAN : STARTER_PLAN;
  const returnUrl = getBillingReturnUrl(request);

  if (isManagedBillingMode()) {
    const pricingPlansUrl = getManagedPricingSelectionUrl(session.shop);

    await recordBillingRequest({
      shopDomain: session.shop,
      planKey: targetPlan,
      returnUrl: pricingPlansUrl,
      mode: "managed",
    });

    return redirect(pricingPlansUrl);
  }

  await recordBillingRequest({
    shopDomain: session.shop,
    planKey: targetPlan,
    returnUrl,
    mode: "manual",
  });

  return billing.request({
    plan: targetPlan,
    isTest: dataIsTestModeFallback(),
    returnUrl,
  });
};

function dataIsTestModeFallback() {
  return process.env.BILLING_TEST_MODE !== "false";
}

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Billing center">
      <s-section heading="Current billing state">
        {data.billingReturnState ? (
          <s-banner tone="success">{data.billingReturnState}</s-banner>
        ) : null}
        {data.billingMode === "managed" ? (
          <s-banner tone="info">
            This app uses Shopify managed pricing. Plan selection is hosted by Shopify, and dev
            store subscriptions stay in test mode automatically.
          </s-banner>
        ) : null}
        <s-paragraph>
          Current plan: <strong>{data.billingState.currentPlan}</strong>
        </s-paragraph>
        <s-paragraph>
          Subscription status: <strong>{data.billingState.subscriptionStatus}</strong>
        </s-paragraph>
        <s-paragraph>
          Trial ends: {formatDate(data.billingState.trialEndsAt)}
          {" · "}
          Mode: {data.isBillingTestMode ? "Test" : "Live"}
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="refresh" />
          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #d1d5db",
              borderRadius: "999px",
              padding: "0.55rem 0.9rem",
              background: "#ffffff",
              color: "#111827",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Refresh billing status
          </button>
        </Form>
      </s-section>

      <s-section heading="Available plans">
        <div style={{ display: "grid", gap: "1rem" }}>
          {data.plans.map((plan) => (
            <s-box
              key={plan.key}
              padding="base"
              borderWidth="base"
              borderRadius="large"
              background="subdued"
            >
              <div style={{ display: "grid", gap: "0.5rem" }}>
                <strong style={{ fontSize: "1.05rem" }}>{plan.title}</strong>
                <div>
                  {plan.currencyCode} {plan.price} / 30 days
                </div>
                <div>{plan.description}</div>
                <ul style={{ margin: 0, paddingInlineStart: "1.25rem" }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Form
                  method="post"
                  reloadDocument={data.billingMode === "managed"}
                  target={data.billingMode === "managed" ? "_top" : undefined}
                >
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="plan" value={plan.key} />
                  <button
                    type="submit"
                    style={{
                      appearance: "none",
                      border: "1px solid #111827",
                      borderRadius: "999px",
                      padding: "0.65rem 1rem",
                      background: "#111827",
                      color: "#ffffff",
                      fontWeight: 600,
                      cursor: "pointer",
                      width: "fit-content",
                    }}
                  >
                    {data.billingMode === "managed"
                      ? `Choose ${plan.title} in Shopify`
                      : `Start ${plan.title}`}
                  </button>
                </Form>
                {data.billingMode === "managed" && data.managedPricingUrl ? (
                  <div style={{ fontSize: "0.9rem", color: "#4b5563" }}>
                    Shopify-hosted plan picker: {data.managedPricingUrl}
                  </div>
                ) : null}
              </div>
            </s-box>
          ))}
        </div>
      </s-section>

      <s-section slot="aside" heading="Active subscriptions">
        {data.billingState.appSubscriptions.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.billingState.appSubscriptions.map((subscription) => (
              <s-box
                key={subscription.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{subscription.name}</strong>
                <div>Status: {subscription.status}</div>
                <div>Period ends: {formatDate(subscription.currentPeriodEnd)}</div>
                <div>Test: {subscription.test ? "Yes" : "No"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No active subscriptions yet.</s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="Recent billing events">
        {data.recentEvents.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentEvents.map((event) => (
              <s-box
                key={event.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{event.eventType}</strong>
                <div>At: {formatDate(event.processedAt ?? event.createdAt)}</div>
                <div>Charge: {event.shopifyChargeId ?? "N/A"}</div>
                <div>
                  Plan:{" "}
                  {typeof event.payload?.planKey === "string"
                    ? event.payload.planKey
                    : typeof event.payload?.currentPlan === "string"
                      ? event.payload.currentPlan
                      : "N/A"}
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No billing events recorded yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
