import { createHash } from "node:crypto";
import { ArtifactType } from "@prisma/client";
import db from "../db.server";
import type { AlertBrief } from "./alert-playbooks.server";
import { buildAlertBrief } from "./alert-playbooks.server";
import { getAiReportGenerationConfig } from "./reports.server";

const ALERT_AI_TIMEOUT_MS = 45_000;
const ALERT_AI_MAX_OUTPUT_TOKENS = 260;

type AlertExplanationNarrative = {
  nextQuestion: string;
  recommendedActions: string[];
  summary: string;
  whyItMatters: string;
};

export type AlertExplanation = {
  generator: {
    fallbackUsed: boolean;
    generatedAt: string;
    mode: "openai-assisted" | "rules-first-fallback";
    modelName: string;
    provider: string;
  };
  narrative: AlertExplanationNarrative;
};

type AlertExplanationInput = {
  alertType: string;
  completenessLevel?: string | null;
  confidenceLevel?: string | null;
  currencyCode?: string | null;
  detectedForDate: string;
  entityKey: string;
  entityType: string;
  id: string;
  impactAmount?: string | null;
  rulePayload?: unknown;
  severity: string;
  title: string;
};

type AiAlertExplanationResult = AlertExplanationNarrative & {
  modelName: string;
  provider: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function stripMarkdownCodeFence(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractFirstJsonObject(value: string) {
  const normalizedValue = stripMarkdownCodeFence(value);

  try {
    return JSON.parse(normalizedValue) as Record<string, unknown>;
  } catch {
    const startIndex = normalizedValue.indexOf("{");
    const endIndex = normalizedValue.lastIndexOf("}");

    if (startIndex < 0 || endIndex <= startIndex) {
      throw new Error("AI alert explanation did not contain a JSON object.");
    }

    return JSON.parse(normalizedValue.slice(startIndex, endIndex + 1)) as Record<string, unknown>;
  }
}

function sanitizeAiLine(value: unknown, fallbackValue: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallbackValue;
  }

  const normalizedValue = value.replace(/\s+/g, " ").trim();
  if (!normalizedValue) {
    return fallbackValue;
  }

  return normalizedValue.slice(0, maxLength);
}

function sanitizeAiList(value: unknown, fallbackValue: string[], maxItems: number) {
  if (!Array.isArray(value)) {
    return fallbackValue;
  }

  const items = value
    .map((entry) => sanitizeAiLine(entry, "", 180))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);

  return items.length > 0 ? items : fallbackValue;
}

function extractResponseOutputText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const entry of output) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const entryRecord = entry as Record<string, unknown>;
    const content = Array.isArray(entryRecord.content)
      ? (entryRecord.content as Array<Record<string, unknown>>)
      : [];

    for (const chunk of content) {
      if (typeof chunk?.text === "string" && chunk.text.trim().length > 0) {
        return chunk.text;
      }

      if (
        typeof chunk?.type === "string" &&
        chunk.type.includes("text") &&
        typeof chunk?.value === "string" &&
        chunk.value.trim().length > 0
      ) {
        return chunk.value;
      }
    }
  }

  throw new Error("AI alert explanation response did not include any text output.");
}

function buildInputHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function collectAllowedNumericTokens(input: AlertExplanationInput, brief: AlertBrief) {
  const sourceText = JSON.stringify({
    alert: input,
    brief,
  });
  const allowedNumbers = new Set<string>();

  for (const match of sourceText.matchAll(/-?\d+(?:\.\d+)?%?/g)) {
    allowedNumbers.add(match[0]);
    const numericValue = Number(match[0].replace(/%$/, ""));
    if (Number.isFinite(numericValue) && !match[0].endsWith("%") && Math.abs(numericValue) <= 1) {
      allowedNumbers.add(`${(numericValue * 100).toFixed(1)}%`);
      allowedNumbers.add(`${(numericValue * 100).toFixed(2)}%`);
    }
  }

  return allowedNumbers;
}

function assertNoUnexpectedNumbers(candidate: AlertExplanationNarrative, input: AlertExplanationInput, brief: AlertBrief) {
  const allowedNumbers = collectAllowedNumericTokens(input, brief);
  const candidateNumbers = new Set(
    JSON.stringify(candidate)
      .match(/-?\d+(?:\.\d+)?%?/g)
      ?.filter(Boolean) ?? [],
  );
  const unexpectedNumbers = [...candidateNumbers].filter((token) => !allowedNumbers.has(token));

  if (unexpectedNumbers.length > 0) {
    throw new Error(`AI alert explanation introduced unsupported numeric tokens: ${unexpectedNumbers.join(", ")}`);
  }
}

export function buildFallbackAlertExplanation(input: AlertExplanationInput, brief: AlertBrief): AlertExplanation {
  return {
    generator: {
      fallbackUsed: true,
      generatedAt: new Date().toISOString(),
      mode: "rules-first-fallback",
      modelName: "rules-first-alert-v1",
      provider: "fallback_template",
    },
    narrative: {
      nextQuestion: `What is the first operational check you want to run for ${input.entityType.toLowerCase()} ${input.entityKey}?`,
      recommendedActions: [brief.primaryAction, ...brief.checks.slice(0, 2)],
      summary: brief.summary,
      whyItMatters: brief.whyItMatters,
    },
  };
}

function parseStoredExplanation(value: unknown): AlertExplanation | null {
  const record = asObject(value);
  const generator = asObject(record?.generator);
  const narrative = asObject(record?.narrative);

  if (!generator || !narrative) {
    return null;
  }

  const recommendedActions = narrative.recommendedActions;
  if (
    typeof generator.generatedAt !== "string" ||
    typeof generator.mode !== "string" ||
    typeof generator.modelName !== "string" ||
    typeof generator.provider !== "string" ||
    typeof narrative.summary !== "string" ||
    typeof narrative.whyItMatters !== "string" ||
    typeof narrative.nextQuestion !== "string" ||
    !Array.isArray(recommendedActions)
  ) {
    return null;
  }

  const normalizedRecommendedActions = recommendedActions.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );

  return {
    generator: {
      fallbackUsed: Boolean(generator.fallbackUsed),
      generatedAt: generator.generatedAt,
      mode: generator.mode === "openai-assisted" ? "openai-assisted" : "rules-first-fallback",
      modelName: generator.modelName,
      provider: generator.provider,
    },
    narrative: {
      nextQuestion: narrative.nextQuestion,
      recommendedActions: normalizedRecommendedActions,
      summary: narrative.summary,
      whyItMatters: narrative.whyItMatters,
    },
  };
}

function buildAiPromptInput(input: AlertExplanationInput, brief: AlertBrief) {
  return JSON.stringify({
    instructions: {
      style: "Direct, operator-friendly, and precise.",
      requirements: [
        "Use only the numbers and entities already present in the structured input.",
        "Return valid JSON with keys summary, whyItMatters, recommendedActions, nextQuestion.",
        "recommendedActions must contain 2 to 4 short strings.",
        "Do not mention data or facts not present in the input.",
      ],
    },
    alert: input,
    rulesFirstPlaybook: brief,
  });
}

export function parseAiExplanationCandidate(responseText: string, input: AlertExplanationInput, brief: AlertBrief) {
  const parsedPayload = extractFirstJsonObject(responseText);
  const candidate: AlertExplanationNarrative = {
    nextQuestion: sanitizeAiLine(
      parsedPayload.nextQuestion,
      `Which single change should the team verify first for ${input.entityType.toLowerCase()} ${input.entityKey}?`,
      180,
    ),
    recommendedActions: sanitizeAiList(parsedPayload.recommendedActions, [brief.primaryAction, ...brief.checks.slice(0, 2)], 4),
    summary: sanitizeAiLine(parsedPayload.summary, brief.summary, 220),
    whyItMatters: sanitizeAiLine(parsedPayload.whyItMatters, brief.whyItMatters, 260),
  };

  assertNoUnexpectedNumbers(candidate, input, brief);
  return candidate;
}

async function generateAiAlertExplanation(input: AlertExplanationInput, brief: AlertBrief): Promise<AiAlertExplanationResult | null> {
  const config = getAiReportGenerationConfig();

  if (!config.ready) {
    return null;
  }

  const systemPrompt =
    "You write concise Profit Guard alert explanations for Shopify merchants. Use only the structured data provided. Do not invent facts, metrics, dates, or percentages. Return valid JSON with keys summary, whyItMatters, recommendedActions, and nextQuestion.";
  const promptInput = buildAiPromptInput(input, brief);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.provider === "openrouter") {
    if (config.refererUrl) {
      headers["HTTP-Referer"] = config.refererUrl;
    }
    headers["X-Title"] = config.appTitle;
  }

  const response = await fetch(
    config.provider === "openrouter"
      ? `${config.baseUrl.replace(/\/$/, "")}/chat/completions`
      : `${config.baseUrl.replace(/\/$/, "")}/responses`,
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(ALERT_AI_TIMEOUT_MS),
      body: JSON.stringify(
        config.provider === "openrouter"
          ? {
              max_tokens: ALERT_AI_MAX_OUTPUT_TOKENS,
              model: config.modelName,
              messages: [
                {
                  role: "system",
                  content: systemPrompt,
                },
                {
                  role: "user",
                  content: promptInput,
                },
              ],
              reasoning: {
                effort: "none",
                exclude: true,
              },
              response_format: {
                type: "json_object",
              },
            }
          : {
              max_output_tokens: ALERT_AI_MAX_OUTPUT_TOKENS,
              model: config.modelName,
              input: [
                {
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: systemPrompt,
                    },
                  ],
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "input_text",
                      text: promptInput,
                    },
                  ],
                },
              ],
            },
      ),
    },
  );

  const rawPayload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok || !rawPayload) {
    const message =
      typeof rawPayload?.error === "object" &&
      rawPayload.error &&
      typeof (rawPayload.error as Record<string, unknown>).message === "string"
        ? ((rawPayload.error as Record<string, unknown>).message as string)
        : `AI provider request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const responseText =
    config.provider === "openrouter"
      ? String(
          ((rawPayload.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)
            ?.content ?? "",
        )
      : extractResponseOutputText(rawPayload);

  const candidate = parseAiExplanationCandidate(responseText, input, brief);

  return {
    ...candidate,
    modelName: config.modelName,
    provider: config.provider,
  };
}

export async function getAlertExplanation(args: {
  alert: AlertExplanationInput;
  currencyCode: string;
  forceRegenerate?: boolean;
  shopId: string;
}) {
  const referenceKey = `alert:${args.alert.id}`;
  const brief = buildAlertBrief({
    alertType: args.alert.alertType,
    completenessLevel: args.alert.completenessLevel,
    confidenceLevel: args.alert.confidenceLevel,
    currencyCode: args.alert.currencyCode ?? args.currencyCode,
    entityKey: args.alert.entityKey,
    entityType: args.alert.entityType,
    impactAmount: args.alert.impactAmount,
    rulePayload: args.alert.rulePayload,
    severity: args.alert.severity,
    title: args.alert.title,
  });
  const inputHash = buildInputHash({
    alert: args.alert,
    brief,
  });
  const existingArtifact = !args.forceRegenerate
    ? await db.aiArtifact.findUnique({
        where: {
          shopId_artifactType_referenceKey_inputHash: {
            artifactType: ArtifactType.ALERT_EXPLANATION,
            inputHash,
            referenceKey,
            shopId: args.shopId,
          },
        },
      })
    : null;

  const parsedExistingExplanation = parseStoredExplanation(existingArtifact?.outputJson);
  if (parsedExistingExplanation) {
    return parsedExistingExplanation;
  }

  const fallbackExplanation = buildFallbackAlertExplanation(args.alert, brief);
  let explanation = fallbackExplanation;
  let artifactErrorMessage: string | null = null;
  let artifactFallbackUsed = true;
  let artifactModelName = fallbackExplanation.generator.modelName;
  let artifactProvider = fallbackExplanation.generator.provider;
  let artifactStatus: "FALLBACK" | "GENERATED" = "FALLBACK";

  try {
    const aiExplanation = await generateAiAlertExplanation(args.alert, brief);

    if (aiExplanation) {
      explanation = {
        generator: {
          fallbackUsed: false,
          generatedAt: fallbackExplanation.generator.generatedAt,
          mode: "openai-assisted",
          modelName: aiExplanation.modelName,
          provider: aiExplanation.provider,
        },
        narrative: {
          nextQuestion: aiExplanation.nextQuestion,
          recommendedActions: aiExplanation.recommendedActions,
          summary: aiExplanation.summary,
          whyItMatters: aiExplanation.whyItMatters,
        },
      };
      artifactFallbackUsed = false;
      artifactModelName = aiExplanation.modelName;
      artifactProvider = aiExplanation.provider;
      artifactStatus = "GENERATED";
    }
  } catch (error) {
    artifactErrorMessage = error instanceof Error ? error.message : String(error);
  }

  await db.aiArtifact.upsert({
    where: {
      shopId_artifactType_referenceKey_inputHash: {
        artifactType: ArtifactType.ALERT_EXPLANATION,
        inputHash,
        referenceKey,
        shopId: args.shopId,
      },
    },
    create: {
      alertId: args.alert.id,
      artifactType: ArtifactType.ALERT_EXPLANATION,
      errorMessage: artifactErrorMessage,
      fallbackUsed: artifactFallbackUsed,
      generatedAt: new Date(explanation.generator.generatedAt),
      inputHash,
      modelName: artifactModelName,
      outputJson: explanation,
      provider: artifactProvider,
      referenceKey,
      shopId: args.shopId,
      status: artifactStatus,
    },
    update: {
      alertId: args.alert.id,
      errorMessage: artifactErrorMessage,
      fallbackUsed: artifactFallbackUsed,
      generatedAt: new Date(explanation.generator.generatedAt),
      modelName: artifactModelName,
      outputJson: explanation,
      provider: artifactProvider,
      status: artifactStatus,
    },
  });

  return explanation;
}
