type SupportedEmailProvider = "disabled" | "resend";

export type EmailDeliveryRequest = {
  html?: string | null;
  idempotencyKey?: string | null;
  replyTo?: string | null;
  subject: string;
  text: string;
  to: string[];
};

export type EmailDeliveryResult = {
  provider: SupportedEmailProvider;
  providerMessageId: string | null;
  raw: Record<string, unknown> | null;
};

function resolveEmailProvider(): SupportedEmailProvider {
  return process.env.PROFIT_GUARD_EMAIL_PROVIDER?.trim().toLowerCase() === "resend" ? "resend" : "disabled";
}

export function getEmailDeliveryConfig() {
  const provider = resolveEmailProvider();
  const fromEmail = process.env.PROFIT_GUARD_EMAIL_FROM?.trim() || "";
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
  const resendBaseUrl = process.env.PROFIT_GUARD_RESEND_BASE_URL?.trim() || "https://api.resend.com";

  return {
    provider,
    fromEmail,
    resendApiKey,
    resendBaseUrl,
    ready: provider === "resend" && fromEmail.length > 0 && resendApiKey.length > 0,
  };
}

export function isEmailDeliveryReady() {
  return getEmailDeliveryConfig().ready;
}

export async function sendExternalEmail(args: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
  const config = getEmailDeliveryConfig();

  if (config.provider === "disabled") {
    throw new Error("External email delivery is disabled. Configure PROFIT_GUARD_EMAIL_PROVIDER to enable sending.");
  }

  if (!config.fromEmail) {
    throw new Error("PROFIT_GUARD_EMAIL_FROM is required when external email delivery is enabled.");
  }

  if (!config.resendApiKey) {
    throw new Error("RESEND_API_KEY is required when PROFIT_GUARD_EMAIL_PROVIDER=resend.");
  }

  if (args.to.length === 0) {
    throw new Error("Email delivery requires at least one recipient.");
  }

  const response = await fetch(`${config.resendBaseUrl.replace(/\/$/, "")}/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      ...(args.idempotencyKey ? { "Idempotency-Key": args.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: args.to,
      subject: args.subject,
      html: args.html ?? undefined,
      text: args.text,
      replyTo: args.replyTo ?? undefined,
    }),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : typeof payload?.error === "string"
          ? payload.error
          : `Email provider request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    provider: config.provider,
    providerMessageId: typeof payload?.id === "string" ? payload.id : null,
    raw: payload,
  };
}
