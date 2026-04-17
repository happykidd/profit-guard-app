import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { getEmbeddedBillingUrl } from "../services/billing-config.server";
import { recordBillingReturn, syncBillingState } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const billingCheck = await billing.check();
  const billingState = await syncBillingState({
    shopDomain: session.shop,
    billingCheck,
  });
  const url = new URL(request.url);

  await recordBillingReturn({
    shopDomain: session.shop,
    requestUrl: request.url,
    searchParams: url.searchParams,
    billingState,
  });

  const embeddedBillingUrl = new URL(getEmbeddedBillingUrl(request));
  embeddedBillingUrl.searchParams.set("billing_status", "returned");

  return redirect(`${embeddedBillingUrl.pathname}${embeddedBillingUrl.search}`);
};

export default function BillingReturnRoute() {
  return null;
}
