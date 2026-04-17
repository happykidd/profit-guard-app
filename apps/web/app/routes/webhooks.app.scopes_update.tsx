import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhookReceipt,
  updateScopesFromWebhook,
} from "../services/platform.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { apiVersion, payload, topic, shop, webhookId } =
    await authenticate.webhook(request);

  console.info(`[webhook] Received ${topic} for ${shop}`);

  const { duplicate, event } = await recordWebhookReceipt({
    shopDomain: shop,
    topic,
    webhookId,
    apiVersion,
    payload,
  });

  if (duplicate) {
    return new Response();
  }

  try {
    await updateScopesFromWebhook(shop, payload as Record<string, unknown>);
    await markWebhookProcessed(event.id);
  } catch (error) {
    console.error("[webhook] Failed to process app/scopes_update", error);
    await markWebhookFailed(event.id, error);
  }

  return new Response();
};
