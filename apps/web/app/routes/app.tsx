import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/alerts">Alerts</s-link>
        <s-link href="/app/profit">Profit</s-link>
        <s-link href="/app/costs">Costs</s-link>
        <s-link href="/app/reports">Reports</s-link>
        <s-link href="/app/feedback">Feedback</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/additional">Operations</s-link>
      </s-app-nav>
      {isNavigating ? (
        <div
          style={{
            background: "#eff6ff",
            borderBottom: "1px solid #bfdbfe",
            color: "#1d4ed8",
            fontWeight: 600,
            padding: "0.75rem 1rem",
          }}
        >
          Loading the next Profit Guard workspace...
        </div>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
