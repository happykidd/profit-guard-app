import { getEmailDeliveryConfig, sendExternalEmail } from "../../../web/app/services/email-delivery.server";
import { loadWorkspaceEnv } from "../services/workspace-env";

function resolveRecipient() {
  const toFlagIndex = process.argv.findIndex((arg) => arg === "--to");
  if (toFlagIndex >= 0) {
    return process.argv[toFlagIndex + 1]?.trim() || "";
  }

  return process.env.PROFIT_GUARD_SUPPORT_EMAIL?.trim() || "";
}

async function main() {
  loadWorkspaceEnv();

  const recipient = resolveRecipient();
  if (!recipient) {
    throw new Error("Missing recipient. Pass --to <email> or set PROFIT_GUARD_SUPPORT_EMAIL.");
  }

  const emailConfig = getEmailDeliveryConfig();
  if (!emailConfig.ready) {
    throw new Error(
      "Email delivery is not ready. Check PROFIT_GUARD_EMAIL_PROVIDER, PROFIT_GUARD_EMAIL_FROM, and RESEND_API_KEY.",
    );
  }

  console.info(
    JSON.stringify(
      {
        provider: emailConfig.provider,
        fromEmail: emailConfig.fromEmail,
        resendBaseUrl: emailConfig.resendBaseUrl,
        recipient,
      },
      null,
      2,
    ),
  );

  const result = await sendExternalEmail({
    subject: "Profit Guard smoke email",
    text: "This is a smoke test email sent from Profit Guard via Resend.",
    html: "<p>This is a smoke test email sent from <strong>Profit Guard</strong> via Resend.</p>",
    to: [recipient],
    replyTo: recipient,
    idempotencyKey: `profit-guard-smoke-email-${Date.now()}`,
  });

  console.info(JSON.stringify(result, null, 2));
}

await main();
