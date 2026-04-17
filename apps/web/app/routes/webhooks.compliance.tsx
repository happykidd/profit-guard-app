import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhookReceipt,
} from "../services/platform.server";
import { processComplianceWebhook } from "../services/compliance.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { apiVersion, shop, topic, webhookId, payload } =
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
    const summary = await processComplianceWebhook({
      apiVersion,
      payload,
      shopDomain: shop,
      topic,
      webhookId,
    });

    console.info("[webhook] compliance summary", {
      shop,
      summary,
      topic,
    });

    await markWebhookProcessed(event.id);
  } catch (error) {
    console.error(`[webhook] Failed to process ${topic}`, error);
    await markWebhookFailed(event.id, error);
  }

  return new Response();
};
