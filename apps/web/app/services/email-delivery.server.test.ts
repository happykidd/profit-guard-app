import assert from "node:assert/strict";
import test from "node:test";
import {
  getEmailDeliveryConfig,
  isEmailDeliveryReady,
  sendExternalEmail,
} from "./email-delivery.server";

function restoreEnvVar(key: string, value: string | undefined) {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }

  delete process.env[key];
}

test("getEmailDeliveryConfig reflects disabled provider by default", () => {
  const originalProvider = process.env.PROFIT_GUARD_EMAIL_PROVIDER;
  const originalFrom = process.env.PROFIT_GUARD_EMAIL_FROM;
  const originalKey = process.env.RESEND_API_KEY;

  delete process.env.PROFIT_GUARD_EMAIL_PROVIDER;
  delete process.env.PROFIT_GUARD_EMAIL_FROM;
  delete process.env.RESEND_API_KEY;

  assert.equal(getEmailDeliveryConfig().provider, "disabled");
  assert.equal(isEmailDeliveryReady(), false);

  restoreEnvVar("PROFIT_GUARD_EMAIL_PROVIDER", originalProvider);
  restoreEnvVar("PROFIT_GUARD_EMAIL_FROM", originalFrom);
  restoreEnvVar("RESEND_API_KEY", originalKey);
});

test("sendExternalEmail posts resend-compatible payloads", async () => {
  const originalProvider = process.env.PROFIT_GUARD_EMAIL_PROVIDER;
  const originalFrom = process.env.PROFIT_GUARD_EMAIL_FROM;
  const originalKey = process.env.RESEND_API_KEY;
  const originalBaseUrl = process.env.PROFIT_GUARD_RESEND_BASE_URL;
  const originalFetch = global.fetch;

  process.env.PROFIT_GUARD_EMAIL_PROVIDER = "resend";
  process.env.PROFIT_GUARD_EMAIL_FROM = "Profit Guard <alerts@example.com>";
  process.env.RESEND_API_KEY = "test-key";
  process.env.PROFIT_GUARD_RESEND_BASE_URL = "https://resend.test";

  let capturedRequest: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
    url: string;
  } | null = null;

  global.fetch = (async (input, init) => {
    capturedRequest = {
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      url: String(input),
    };

    return new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const result = await sendExternalEmail({
      html: "<p>Hello from Profit Guard</p>",
      idempotencyKey: "digest_123",
      replyTo: "support@example.com",
      subject: "Profit Guard daily summary",
      text: "Hello from Profit Guard",
      to: ["owner@example.com"],
    });

    assert.equal(result.provider, "resend");
    assert.equal(result.providerMessageId, "email_123");
    if (!capturedRequest) {
      throw new Error("expected mocked fetch to capture a request");
    }

    const request = capturedRequest as {
      body: Record<string, unknown>;
      headers: Record<string, string>;
      url: string;
    };

    assert.equal(request.url, "https://resend.test/emails");
    assert.equal(request.headers.authorization, "Bearer test-key");
    assert.equal(request.headers["idempotency-key"], "digest_123");
    assert.equal(request.body.from, "Profit Guard <alerts@example.com>");
    assert.deepEqual(request.body.to, ["owner@example.com"]);
    assert.equal(request.body.subject, "Profit Guard daily summary");
    assert.equal(request.body.replyTo, "support@example.com");
  } finally {
    restoreEnvVar("PROFIT_GUARD_EMAIL_PROVIDER", originalProvider);
    restoreEnvVar("PROFIT_GUARD_EMAIL_FROM", originalFrom);
    restoreEnvVar("RESEND_API_KEY", originalKey);
    restoreEnvVar("PROFIT_GUARD_RESEND_BASE_URL", originalBaseUrl);
    global.fetch = originalFetch;
  }
});
