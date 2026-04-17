import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhookReceipt,
  updateShopFromWebhook,
} from "../services/platform.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { apiVersion, payload, shop, topic, webhookId } =
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
    await updateShopFromWebhook(shop, payload as Record<string, unknown>);
    await markWebhookProcessed(event.id);
  } catch (error) {
    console.error("[webhook] Failed to process shop/update", error);
    await markWebhookFailed(event.id, error);
  }

  return new Response();
};
