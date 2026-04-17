import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  markShopUninstalled,
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhookReceipt,
} from "../services/platform.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { apiVersion, session, shop, topic, webhookId, payload } =
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
    const cleanupSummary = await markShopUninstalled(shop);

    // Webhook requests can trigger multiple times and after an app has already been uninstalled.
    // If this webhook already ran, the session may have been deleted previously.
    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }

    console.info("[webhook] app/uninstalled cleanup summary", {
      shop,
      ...cleanupSummary,
    });

    await markWebhookProcessed(event.id);
  } catch (error) {
    console.error("[webhook] Failed to process app/uninstalled", error);
    await markWebhookFailed(event.id, error);
  }

  return new Response();
};
