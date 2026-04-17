import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  ArtifactType,
  DataCompletenessLevel,
  ReportType,
} from "@prisma/client";
import db from "../db.server";

export const REPORT_EXPORT_FORMATS = ["json", "markdown", "csv", "html", "email_text", "pdf", "share_image"] as const;
const AI_REPORT_TIMEOUT_MS = 45_000;
const AI_REPORT_MAX_OUTPUT_TOKENS = 220;
const REPORT_SHARE_IMAGE_WIDTH = 1400;

export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];
export type ReportGeneratorMode = "rules-first-fallback" | "openai-assisted";

type ReportMetricSource = {
  metricDate: Date;
  ordersCount: number;
  grossSalesAmount: number;
  discountAmount: number;
  refundAmount: number;
  shippingRevenueAmount: number;
  shippingCostEstimateAmount: number;
  transactionFeeEstimateAmount: number;
  productCostAmount: number;
  grossProfitBeforeAdSpend: number;
  grossMarginRate: number | null;
  refundRate: number | null;
  discountRate: number | null;
  completenessLevel: DataCompletenessLevel;
};

type ReportAlertSource = {
  alertType: string;
  severity: string;
  status: string;
  title: string;
  impactAmount: number | null;
  currencyCode: string | null;
  detectedForDate: Date;
};

type ReportHealthSource = {
  scoreDate: Date;
  score: number;
  levelLabel: string;
} | null;

type ReportCompletenessSource = {
  snapshotDate: Date;
  level: DataCompletenessLevel;
  variantCoverageRate: number | null;
  orderCoverageRate: number | null;
} | null;

export type ReportPayload = {
  version: 1;
  reportType: "DAILY" | "WEEKLY";
  period: {
    end: string;
    label: string;
    start: string;
  };
  generator: {
    fallbackUsed: boolean;
    generatedAt: string;
    mode: ReportGeneratorMode;
    modelName: string;
    provider: string;
  };
  narrative: {
    headline: string;
    summary: string;
  };
  kpis: {
    daysCovered: number;
    discountAmount: string;
    discountRate: string | null;
    grossMarginRate: string | null;
    grossProfitBeforeAdSpend: string;
    grossSalesAmount: string;
    ordersCount: number;
    productCostAmount: string;
    refundAmount: string;
    refundRate: string | null;
    shippingCostEstimateAmount: string;
    transactionFeeEstimateAmount: string;
  };
  health: {
    completenessLevel: DataCompletenessLevel | null;
    levelLabel: string | null;
    orderCoverageRate: string | null;
    score: number | null;
    variantCoverageRate: string | null;
  };
  trend: {
    grossMarginDeltaRate: string | null;
    grossSalesDeltaAmount: string | null;
  };
  highlights: string[];
  watchouts: string[];
  topAlerts: Array<{
    alertType: string;
    currencyCode: string | null;
    detectedForDate: string;
    impactAmount: string | null;
    severity: string;
    status: string;
    title: string;
  }>;
};

type AiNarrativeCandidate = {
  headline: string;
  highlights: string[];
  summary: string;
  watchouts: string[];
};

type AiNarrativeResult = AiNarrativeCandidate & {
  modelName: string;
  provider: string;
};

type AiProvider = "disabled" | "openai" | "openrouter";

export type StoredReportSnapshot = {
  aiArtifactId: string | null;
  createdAt: string;
  id: string;
  payload: ReportPayload;
  periodEnd: string;
  periodStart: string;
  reportType: "DAILY" | "WEEKLY";
  updatedAt: string;
};

type StoredDigestDelivery = {
  attemptCount: number;
  createdAt: string;
  deliveredAt: string | null;
  exportFormat: string;
  id: string;
  lastAttemptAt: string | null;
  lastError: string | null;
  recipientEmail: string;
  reportSnapshotId: string | null;
  reportType: "DAILY" | "WEEKLY";
  status: string;
  subject: string;
  updatedAt: string;
};

function normalizeNumber(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundRate(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(5));
}

function toMoneyString(value: number) {
  return roundMoney(value).toFixed(2);
}

function toRateString(value: number | null) {
  const rounded = roundRate(value);
  return rounded == null ? null : rounded.toFixed(5);
}

function formatPercentLabel(value: string | null | undefined) {
  if (!value) {
    return "not available";
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "not available";
  }

  return `${(numericValue * 100).toFixed(1)}%`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapPlainText(value: string, maxCharacters: number) {
  const normalizedValue = value.replace(/\s+/g, " ").trim();

  if (!normalizedValue) {
    return [""];
  }

  const words = normalizedValue.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length <= maxCharacters) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [normalizedValue];
}

function escapeSvgText(value: unknown) {
  return escapeHtml(value);
}

function buildReportShareImageSvg(args: {
  currencyCode: string;
  snapshot: StoredReportSnapshot;
}) {
  const payload = args.snapshot.payload;
  const columnWidth = 620;
  const leftColumnX = 72;
  const rightColumnX = 708;
  const cardWidth = 280;
  const highlightLines = payload.highlights.flatMap((highlight) => wrapPlainText(highlight, 48));
  const watchoutLines = payload.watchouts.flatMap((watchout) => wrapPlainText(watchout, 48));
  const alertLines =
    payload.topAlerts.length > 0
      ? payload.topAlerts.flatMap((alert) =>
          wrapPlainText(
            `[${alert.severity}] ${alert.title}${
              alert.impactAmount ? ` · ${alert.impactAmount} ${alert.currencyCode ?? args.currencyCode}` : ""
            }`,
            48,
          ),
        )
      : ["No alerts included in this report window."];
  const totalLines =
    highlightLines.length +
    watchoutLines.length +
    alertLines.length +
    24;
  const height = Math.max(1180, 430 + totalLines * 22);
  const metricCards = [
    {
      label: "Gross sales",
      value: `${payload.kpis.grossSalesAmount} ${args.currencyCode}`,
      x: 72,
      y: 240,
    },
    {
      label: "Gross profit",
      value: `${payload.kpis.grossProfitBeforeAdSpend} ${args.currencyCode}`,
      x: 376,
      y: 240,
    },
    {
      label: "Margin",
      value: formatPercentLabel(payload.kpis.grossMarginRate),
      x: 680,
      y: 240,
    },
    {
      label: "Orders",
      value: String(payload.kpis.ordersCount),
      x: 984,
      y: 240,
    },
  ];

  const renderLines = (lines: string[], x: number, startY: number, color: string) =>
    lines
      .map(
        (line, index) =>
          `<text x="${x}" y="${startY + index * 24}" fill="${color}" font-size="24" font-family="'Helvetica Neue', Arial, sans-serif">${escapeSvgText(line)}</text>`,
      )
      .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_SHARE_IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${REPORT_SHARE_IMAGE_WIDTH} ${height}" role="img" aria-label="${escapeSvgText(payload.narrative.headline)}">
  <defs>
    <linearGradient id="report_bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#e0f2fe" />
    </linearGradient>
  </defs>
  <rect width="${REPORT_SHARE_IMAGE_WIDTH}" height="${height}" rx="44" fill="url(#report_bg)" />
  <rect x="36" y="36" width="${REPORT_SHARE_IMAGE_WIDTH - 72}" height="${height - 72}" rx="34" fill="#ffffff" stroke="#dbeafe" stroke-width="2" />
  <text x="72" y="92" fill="#0f766e" font-size="26" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">Profit Guard</text>
  <text x="72" y="144" fill="#0f172a" font-size="54" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">${escapeSvgText(payload.narrative.headline)}</text>
  ${renderLines(wrapPlainText(payload.narrative.summary, 92), 72, 188, "#475569")}
  <text x="72" y="224" fill="#64748b" font-size="22" font-family="'Helvetica Neue', Arial, sans-serif">${escapeSvgText(payload.period.label)} · ${escapeSvgText(payload.reportType)} summary · ${escapeSvgText(payload.generator.provider)}</text>
  ${metricCards
    .map(
      (card) => `
    <rect x="${card.x}" y="${card.y}" width="${cardWidth}" height="126" rx="24" fill="#eff6ff" stroke="#bfdbfe" />
    <text x="${card.x + 24}" y="${card.y + 42}" fill="#1d4ed8" font-size="22" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">${escapeSvgText(card.label)}</text>
    <text x="${card.x + 24}" y="${card.y + 84}" fill="#111827" font-size="32" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">${escapeSvgText(card.value)}</text>`,
    )
    .join("")}
  <rect x="${leftColumnX}" y="392" width="${columnWidth}" height="${height - 460}" rx="26" fill="#f8fafc" stroke="#e5e7eb" />
  <rect x="${rightColumnX}" y="392" width="${columnWidth}" height="${height - 460}" rx="26" fill="#f8fafc" stroke="#e5e7eb" />
  <text x="${leftColumnX + 28}" y="438" fill="#0f172a" font-size="30" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">Highlights</text>
  ${renderLines(highlightLines, leftColumnX + 28, 478, "#0f172a")}
  <text x="${rightColumnX + 28}" y="438" fill="#0f172a" font-size="30" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">Watchouts</text>
  ${renderLines(watchoutLines, rightColumnX + 28, 478, "#7c2d12")}
  <text x="${leftColumnX + 28}" y="${Math.max(620, 498 + highlightLines.length * 24)}" fill="#0f172a" font-size="30" font-weight="700" font-family="'Helvetica Neue', Arial, sans-serif">Top alerts</text>
  ${renderLines(alertLines, leftColumnX + 28, Math.max(660, 538 + highlightLines.length * 24), "#1f2937")}
  <text x="72" y="${height - 70}" fill="#64748b" font-size="20" font-family="'Helvetica Neue', Arial, sans-serif">Generated ${escapeSvgText(payload.generator.generatedAt)} · ${escapeSvgText(payload.generator.mode)} · Profit Guard share image export</text>
</svg>`;
}

export async function buildReportPdfContent(args: {
  currencyCode: string;
  snapshot: StoredReportSnapshot;
}) {
  const payload = args.snapshot.payload;
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([612, 792]);
  let cursorY = 744;
  const marginX = 52;
  const footerY = 42;
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyColor = rgb(17 / 255, 24 / 255, 39 / 255);
  const mutedColor = rgb(71 / 255, 85 / 255, 105 / 255);
  const accentColor = rgb(15 / 255, 118 / 255, 110 / 255);

  const ensureRoom = (requiredHeight: number) => {
    if (cursorY - requiredHeight >= footerY) {
      return;
    }

    page = pdf.addPage([612, 792]);
    cursorY = 744;
  };

  const drawLineBlock = (lines: string[], options: { size: number; color: ReturnType<typeof rgb>; font: typeof regularFont; leading?: number }) => {
    const leading = options.leading ?? options.size + 4;
    ensureRoom(lines.length * leading + 8);

    for (const line of lines) {
      page.drawText(line, {
        x: marginX,
        y: cursorY,
        size: options.size,
        font: options.font,
        color: options.color,
      });
      cursorY -= leading;
    }

    cursorY -= 6;
  };

  const writeSectionTitle = (title: string) => {
    drawLineBlock([title], {
      color: bodyColor,
      font: boldFont,
      size: 15,
      leading: 18,
    });
  };

  drawLineBlock(["Profit Guard"], {
    color: accentColor,
    font: boldFont,
    size: 12,
    leading: 16,
  });
  drawLineBlock(wrapPlainText(payload.narrative.headline, 64), {
    color: bodyColor,
    font: boldFont,
    size: 22,
    leading: 28,
  });
  drawLineBlock(wrapPlainText(payload.narrative.summary, 86), {
    color: mutedColor,
    font: regularFont,
    size: 11,
    leading: 15,
  });
  drawLineBlock([`${payload.period.label} · ${payload.reportType} summary · ${payload.generator.provider}`], {
    color: mutedColor,
    font: regularFont,
    size: 10,
    leading: 14,
  });

  writeSectionTitle("KPIs");
  drawLineBlock(
    [
      `Orders: ${payload.kpis.ordersCount}`,
      `Gross sales: ${payload.kpis.grossSalesAmount} ${args.currencyCode}`,
      `Gross profit before ad spend: ${payload.kpis.grossProfitBeforeAdSpend} ${args.currencyCode}`,
      `Gross margin: ${formatPercentLabel(payload.kpis.grossMarginRate)}`,
      `Refund rate: ${formatPercentLabel(payload.kpis.refundRate)}`,
      `Discount rate: ${formatPercentLabel(payload.kpis.discountRate)}`,
      `Health score: ${payload.health.score == null ? "not available" : String(payload.health.score)}`,
      `Completeness: ${payload.health.completenessLevel ?? "not available"}`,
    ],
    {
      color: bodyColor,
      font: regularFont,
      size: 11,
      leading: 15,
    },
  );

  writeSectionTitle("Highlights");
  drawLineBlock(
    payload.highlights.flatMap((entry) => wrapPlainText(`• ${entry}`, 86)),
    {
      color: bodyColor,
      font: regularFont,
      size: 11,
      leading: 15,
    },
  );

  writeSectionTitle("Watchouts");
  drawLineBlock(
    payload.watchouts.flatMap((entry) => wrapPlainText(`• ${entry}`, 86)),
    {
      color: bodyColor,
      font: regularFont,
      size: 11,
      leading: 15,
    },
  );

  writeSectionTitle("Top alerts");
  drawLineBlock(
    (payload.topAlerts.length > 0
      ? payload.topAlerts.map(
          (alert) =>
            `• [${alert.severity}] ${alert.title}${
              alert.impactAmount ? ` · impact ${alert.impactAmount} ${alert.currencyCode ?? args.currencyCode}` : ""
            }`,
        )
      : ["• No alerts were included in this report window."]).flatMap((entry) => wrapPlainText(entry, 86)),
    {
      color: bodyColor,
      font: regularFont,
      size: 11,
      leading: 15,
    },
  );

  page.drawText(`Generated ${payload.generator.generatedAt} · Profit Guard PDF export`, {
    x: marginX,
    y: 24,
    size: 9,
    font: regularFont,
    color: mutedColor,
  });

  return pdf.save();
}

function divideOrNull(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

function formatPeriodLabel(reportType: ReportType, periodStart: Date, periodEnd: Date) {
  if (reportType === ReportType.DAILY) {
    return formatDateLabel(periodEnd);
  }

  return `${formatDateLabel(periodStart)} - ${formatDateLabel(periodEnd)}`;
}

function getNotificationRecipients(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function resolveReportExportFormat(value: string | null | undefined): ReportExportFormat | null {
  const normalizedValue = (value ?? "").trim().toLowerCase();
  return REPORT_EXPORT_FORMATS.includes(normalizedValue as ReportExportFormat)
    ? (normalizedValue as ReportExportFormat)
    : null;
}

function getReportReferenceKey(reportType: ReportType, periodStart: Date, periodEnd: Date) {
  return `${reportType}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
}

function getArtifactTypeForReport(reportType: ReportType) {
  return reportType === ReportType.DAILY ? ArtifactType.DAILY_SUMMARY : ArtifactType.WEEKLY_SUMMARY;
}

function resolveAiProvider(): AiProvider {
  const provider = process.env.PROFIT_GUARD_AI_PROVIDER?.trim().toLowerCase();

  if (provider === "openai" || provider === "openrouter") {
    return provider;
  }

  return "disabled";
}

export function getAiReportGenerationConfig() {
  const provider = resolveAiProvider();
  const apiKey =
    provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY?.trim() || ""
      : process.env.OPENAI_API_KEY?.trim() || "";
  const baseUrl =
    provider === "openrouter"
      ? process.env.PROFIT_GUARD_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1"
      : process.env.PROFIT_GUARD_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const modelName =
    provider === "openrouter"
      ? process.env.PROFIT_GUARD_OPENROUTER_MODEL?.trim() || "openai/gpt-4.1-mini"
      : process.env.PROFIT_GUARD_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
  const refererUrl = process.env.SHOPIFY_APP_URL?.trim() || "";
  const appTitle = process.env.PROFIT_GUARD_OPENROUTER_APP_TITLE?.trim() || "Profit Guard";

  return {
    apiKey,
    appTitle,
    baseUrl,
    modelName,
    provider,
    ready: provider !== "disabled" && apiKey.length > 0,
    refererUrl,
  };
}

function buildAiPromptInput(payload: ReportPayload) {
  return JSON.stringify({
    instructions: {
      style: "Direct, operator-friendly, actionable, and calm.",
      summaryRequirements: [
        "headline should be a single sentence",
        "summary should stay under 260 characters",
        "highlights should emphasize confirmed positives or momentum",
        "watchouts should emphasize risks or next checks",
        "reuse only numbers that already exist in the input payload",
      ],
    },
    payload,
  });
}

function sanitizeAiLine(value: unknown, fallbackValue: string, maxLength: number) {
  if (typeof value !== "string") {
    return fallbackValue;
  }

  const normalizedValue = value.replace(/\s+/g, " ").trim();
  if (normalizedValue.length === 0) {
    return fallbackValue;
  }

  return normalizedValue.slice(0, maxLength);
}

function sanitizeAiList(value: unknown, fallbackValue: string[], maxItems: number) {
  if (!Array.isArray(value)) {
    return fallbackValue;
  }

  const normalizedItems = value
    .map((entry) => sanitizeAiLine(entry, "", 220))
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);

  return normalizedItems.length > 0 ? normalizedItems : fallbackValue;
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
      throw new Error("AI narrative response did not contain a JSON object.");
    }

    return JSON.parse(normalizedValue.slice(startIndex, endIndex + 1)) as Record<string, unknown>;
  }
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

  throw new Error("AI narrative response did not include any text output.");
}

function collectAllowedNumericTokens(payload: ReportPayload) {
  const sourceText = JSON.stringify({
    fallbackNarrative: payload.narrative,
    health: payload.health,
    kpis: payload.kpis,
    period: payload.period,
    topAlerts: payload.topAlerts,
    trend: payload.trend,
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

function collectCandidateNumericTokens(candidate: AiNarrativeCandidate) {
  const candidateText = JSON.stringify(candidate);
  const numbers = new Set<string>();

  for (const match of candidateText.matchAll(/-?\d+(?:\.\d+)?%?/g)) {
    numbers.add(match[0]);
  }

  return numbers;
}

function assertNoUnexpectedNumbers(candidate: AiNarrativeCandidate, payload: ReportPayload) {
  const allowedNumbers = collectAllowedNumericTokens(payload);
  const candidateNumbers = collectCandidateNumericTokens(candidate);
  const unexpectedNumbers = [...candidateNumbers].filter((token) => !allowedNumbers.has(token));

  if (unexpectedNumbers.length === 0) {
    return;
  }

  throw new Error(`AI narrative introduced unsupported numeric tokens: ${unexpectedNumbers.join(", ")}`);
}

function parseAiNarrativeCandidate(responseText: string, payload: ReportPayload) {
  const parsedPayload = extractFirstJsonObject(responseText);
  const candidate: AiNarrativeCandidate = {
    headline: sanitizeAiLine(parsedPayload.headline, payload.narrative.headline, 180),
    highlights: sanitizeAiList(parsedPayload.highlights, payload.highlights, 4),
    summary: sanitizeAiLine(parsedPayload.summary, payload.narrative.summary, 260),
    watchouts: sanitizeAiList(parsedPayload.watchouts, payload.watchouts, 4),
  };

  assertNoUnexpectedNumbers(candidate, payload);

  return candidate;
}

async function generateAiNarrative(payload: ReportPayload): Promise<AiNarrativeResult | null> {
  const config = getAiReportGenerationConfig();

  if (!config.ready) {
    return null;
  }

  const sharedSystemPrompt =
    "You write concise Profit Guard summaries for Shopify merchants. Use only the structured data provided. Do not invent facts, metrics, dates, or percentages. Return valid JSON with keys headline, summary, highlights, and watchouts. highlights and watchouts must each contain 2 to 4 short strings.";
  const promptInput = buildAiPromptInput(payload);
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
      signal: AbortSignal.timeout(AI_REPORT_TIMEOUT_MS),
      body: JSON.stringify(
        config.provider === "openrouter"
          ? {
              max_tokens: AI_REPORT_MAX_OUTPUT_TOKENS,
              model: config.modelName,
              messages: [
                {
                  role: "system",
                  content: sharedSystemPrompt,
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
              max_output_tokens: AI_REPORT_MAX_OUTPUT_TOKENS,
              model: config.modelName,
              input: [
                {
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: sharedSystemPrompt,
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
  const candidate = parseAiNarrativeCandidate(responseText, payload);

  return {
    ...candidate,
    modelName: config.modelName,
    provider: config.provider,
  };
}

export function buildDigestDeliverySubject(args: {
  periodLabel: string;
  reportType: "DAILY" | "WEEKLY";
}) {
  return `Profit Guard ${args.reportType.toLowerCase()} summary for ${args.periodLabel}`;
}

function buildInputHash(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildNarrativeHeadline(args: {
  grossMarginRate: number | null;
  health: ReportHealthSource;
  periodLabel: string;
  reportType: ReportType;
}) {
  const summaryType = args.reportType === ReportType.DAILY ? "Daily" : "Weekly";

  if (args.grossMarginRate == null) {
    return `${summaryType} summary for ${args.periodLabel}: margin is not available yet.`;
  }

  if (args.grossMarginRate < 0.1) {
    return `${summaryType} summary for ${args.periodLabel}: gross margin is critically low.`;
  }

  if (args.health?.score != null && args.health.score >= 80) {
    return `${summaryType} summary for ${args.periodLabel}: profitability looks healthy.`;
  }

  return `${summaryType} summary for ${args.periodLabel}: monitor margin and refund pressure.`;
}

export function buildFallbackReportPayload(args: {
  alerts: ReportAlertSource[];
  completeness: ReportCompletenessSource;
  currencyCode: string;
  generatedAt?: Date;
  health: ReportHealthSource;
  metrics: ReportMetricSource[];
  periodEnd: Date;
  periodStart: Date;
  reportType: ReportType;
}): ReportPayload {
  if (args.metrics.length === 0) {
    throw new Error("No daily metrics available for the requested report period.");
  }

  const generatedAt = args.generatedAt ?? new Date();
  const earliestMetric = args.metrics[0];
  const latestMetric = args.metrics[args.metrics.length - 1];
  const totals = args.metrics.reduce(
    (accumulator, metric) => {
      accumulator.ordersCount += metric.ordersCount;
      accumulator.grossSalesAmount += metric.grossSalesAmount;
      accumulator.discountAmount += metric.discountAmount;
      accumulator.refundAmount += metric.refundAmount;
      accumulator.shippingRevenueAmount += metric.shippingRevenueAmount;
      accumulator.shippingCostEstimateAmount += metric.shippingCostEstimateAmount;
      accumulator.transactionFeeEstimateAmount += metric.transactionFeeEstimateAmount;
      accumulator.productCostAmount += metric.productCostAmount;
      accumulator.grossProfitBeforeAdSpend += metric.grossProfitBeforeAdSpend;

      return accumulator;
    },
    {
      discountAmount: 0,
      grossProfitBeforeAdSpend: 0,
      grossSalesAmount: 0,
      ordersCount: 0,
      productCostAmount: 0,
      refundAmount: 0,
      shippingCostEstimateAmount: 0,
      shippingRevenueAmount: 0,
      transactionFeeEstimateAmount: 0,
    },
  );

  const grossMarginRate = divideOrNull(totals.grossProfitBeforeAdSpend, totals.grossSalesAmount);
  const refundRate = divideOrNull(totals.refundAmount, totals.grossSalesAmount);
  const discountRate = divideOrNull(totals.discountAmount, totals.grossSalesAmount);
  const grossSalesDeltaAmount = latestMetric
    ? roundMoney(latestMetric.grossSalesAmount - earliestMetric.grossSalesAmount)
    : null;
  const grossMarginDeltaRate =
    earliestMetric.grossMarginRate != null && latestMetric.grossMarginRate != null
      ? roundRate(latestMetric.grossMarginRate - earliestMetric.grossMarginRate)
      : null;
  const periodLabel = formatPeriodLabel(args.reportType, args.periodStart, args.periodEnd);

  const highlights = [
    `${args.metrics.length} metric day(s) produced ${totals.ordersCount} order(s) and ${toMoneyString(totals.grossSalesAmount)} ${args.currencyCode} in gross sales.`,
    `Estimated gross profit before ad spend finished at ${toMoneyString(totals.grossProfitBeforeAdSpend)} ${args.currencyCode} with margin ${grossMarginRate == null ? "not available" : `${(grossMarginRate * 100).toFixed(1)}%`}.`,
  ];

  if (args.health?.score != null) {
    highlights.push(`Latest health score is ${args.health.score} (${args.health.levelLabel}).`);
  }

  if (args.completeness?.level) {
    highlights.push(
      `Data completeness is ${args.completeness.level} with variant coverage ${
        args.completeness.variantCoverageRate == null
          ? "not available"
          : `${(args.completeness.variantCoverageRate * 100).toFixed(1)}%`
      }.`,
    );
  }

  const watchouts: string[] = [];

  if (refundRate != null && refundRate >= 0.07) {
    watchouts.push(`Refund rate is elevated at ${(refundRate * 100).toFixed(1)}%.`);
  }

  if (discountRate != null && discountRate >= 0.12) {
    watchouts.push(`Discount share is elevated at ${(discountRate * 100).toFixed(1)}%.`);
  }

  if (args.completeness?.level === DataCompletenessLevel.LOW || args.completeness?.level === DataCompletenessLevel.MEDIUM) {
    watchouts.push(`Completeness is ${args.completeness.level}, so reported profit still depends on estimated cost coverage.`);
  }

  if (args.alerts[0]) {
    watchouts.push(`Top alert: ${args.alerts[0].title}`);
  }

  if (watchouts.length === 0) {
    watchouts.push("No additional watchouts were detected in the current structured inputs.");
  }

  return {
    version: 1 as const,
    reportType: args.reportType,
    period: {
      end: args.periodEnd.toISOString(),
      label: periodLabel,
      start: args.periodStart.toISOString(),
    },
    generator: {
      fallbackUsed: true,
      generatedAt: generatedAt.toISOString(),
      mode: "rules-first-fallback" as const,
      modelName: "rules-first-v1",
      provider: "fallback_template",
    },
    narrative: {
      headline: buildNarrativeHeadline({
        grossMarginRate,
        health: args.health,
        periodLabel,
        reportType: args.reportType,
      }),
      summary: `Processed ${totals.ordersCount} order(s) across ${args.metrics.length} metric day(s). Gross sales landed at ${toMoneyString(totals.grossSalesAmount)} ${args.currencyCode}; gross profit before ad spend landed at ${toMoneyString(totals.grossProfitBeforeAdSpend)} ${args.currencyCode}.`,
    },
    kpis: {
      daysCovered: args.metrics.length,
      discountAmount: toMoneyString(totals.discountAmount),
      discountRate: toRateString(discountRate),
      grossMarginRate: toRateString(grossMarginRate),
      grossProfitBeforeAdSpend: toMoneyString(totals.grossProfitBeforeAdSpend),
      grossSalesAmount: toMoneyString(totals.grossSalesAmount),
      ordersCount: totals.ordersCount,
      productCostAmount: toMoneyString(totals.productCostAmount),
      refundAmount: toMoneyString(totals.refundAmount),
      refundRate: toRateString(refundRate),
      shippingCostEstimateAmount: toMoneyString(totals.shippingCostEstimateAmount),
      transactionFeeEstimateAmount: toMoneyString(totals.transactionFeeEstimateAmount),
    },
    health: {
      completenessLevel: args.completeness?.level ?? null,
      levelLabel: args.health?.levelLabel ?? null,
      orderCoverageRate: toRateString(args.completeness?.orderCoverageRate ?? null),
      score: args.health?.score ?? null,
      variantCoverageRate: toRateString(args.completeness?.variantCoverageRate ?? null),
    },
    trend: {
      grossMarginDeltaRate: toRateString(grossMarginDeltaRate),
      grossSalesDeltaAmount: grossSalesDeltaAmount == null ? null : toMoneyString(grossSalesDeltaAmount),
    },
    highlights,
    watchouts,
    topAlerts: args.alerts.map((alert) => ({
      alertType: alert.alertType,
      currencyCode: alert.currencyCode,
      detectedForDate: alert.detectedForDate.toISOString(),
      impactAmount: alert.impactAmount == null ? null : toMoneyString(alert.impactAmount),
      severity: alert.severity,
      status: alert.status,
      title: alert.title,
    })),
  };
}

export function renderReportExportContent(args: {
  currencyCode: string;
  format: ReportExportFormat;
  snapshot: StoredReportSnapshot;
}) {
  const payload = args.snapshot.payload;

  if (args.format === "json") {
    return JSON.stringify(
      {
        ...payload,
        snapshotId: args.snapshot.id,
      },
      null,
      2,
    );
  }

  if (args.format === "csv") {
    const rows = [
      ["metric", "value"],
      ["report_type", payload.reportType],
      ["period_label", payload.period.label],
      ["orders_count", String(payload.kpis.ordersCount)],
      ["gross_sales_amount", payload.kpis.grossSalesAmount],
      ["gross_profit_before_ad_spend", payload.kpis.grossProfitBeforeAdSpend],
      ["gross_margin_rate", payload.kpis.grossMarginRate ?? ""],
      ["refund_amount", payload.kpis.refundAmount],
      ["refund_rate", payload.kpis.refundRate ?? ""],
      ["discount_amount", payload.kpis.discountAmount],
      ["discount_rate", payload.kpis.discountRate ?? ""],
      ["product_cost_amount", payload.kpis.productCostAmount],
      ["shipping_cost_estimate_amount", payload.kpis.shippingCostEstimateAmount],
      ["transaction_fee_estimate_amount", payload.kpis.transactionFeeEstimateAmount],
      ["health_score", payload.health.score == null ? "" : String(payload.health.score)],
      ["health_level", payload.health.levelLabel ?? ""],
      ["completeness_level", payload.health.completenessLevel ?? ""],
    ];

    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(",")).join("\n");
  }

  if (args.format === "email_text") {
    const topAlertsText =
      payload.topAlerts.length > 0
        ? payload.topAlerts
            .map(
              (alert, index) =>
                `${index + 1}. ${alert.title} [${alert.severity}]${
                  alert.impactAmount ? ` · impact ${alert.impactAmount} ${alert.currencyCode ?? args.currencyCode}` : ""
                }`,
            )
            .join("\n")
        : "1. No alerts were included in this report window.";

    return [
      `Subject: ${buildDigestDeliverySubject({
        periodLabel: payload.period.label,
        reportType: payload.reportType,
      })}`,
      "",
      payload.narrative.headline,
      payload.narrative.summary,
      "",
      `Orders: ${payload.kpis.ordersCount}`,
      `Gross sales: ${payload.kpis.grossSalesAmount} ${args.currencyCode}`,
      `Gross profit before ad spend: ${payload.kpis.grossProfitBeforeAdSpend} ${args.currencyCode}`,
      `Gross margin: ${formatPercentLabel(payload.kpis.grossMarginRate)}`,
      `Refund rate: ${formatPercentLabel(payload.kpis.refundRate)}`,
      `Discount rate: ${formatPercentLabel(payload.kpis.discountRate)}`,
      "",
      "Highlights:",
      ...payload.highlights.map((highlight) => `- ${highlight}`),
      "",
      "Watchouts:",
      ...payload.watchouts.map((watchout) => `- ${watchout}`),
      "",
      "Top alerts:",
      topAlertsText,
    ].join("\n");
  }

  if (args.format === "html") {
    const topAlertsSection =
      payload.topAlerts.length > 0
        ? payload.topAlerts
            .map(
              (alert) => `
                <li style="margin-bottom:12px;">
                  <strong>${escapeHtml(alert.title)}</strong><br />
                  <span style="color:#4b5563;">${escapeHtml(alert.severity)} · ${escapeHtml(alert.alertType)} · ${escapeHtml(alert.detectedForDate)}</span>
                  ${
                    alert.impactAmount
                      ? `<br /><span>Impact: ${escapeHtml(alert.impactAmount)} ${escapeHtml(alert.currencyCode ?? args.currencyCode)}</span>`
                      : ""
                  }
                </li>`,
            )
            .join("")
        : '<li style="margin-bottom:12px;">No alerts were included in this report window.</li>';

    const renderBulletList = (items: string[]) =>
      items.map((item) => `<li style="margin-bottom:8px;">${escapeHtml(item)}</li>`).join("");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(payload.narrative.headline)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f8fafc;color:#111827;font-family:Arial,sans-serif;line-height:1.6;">
    <main style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;">
      <p style="margin:0 0 8px;color:#0f766e;font-weight:700;">Profit Guard</p>
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;">${escapeHtml(payload.narrative.headline)}</h1>
      <p style="margin:0 0 20px;color:#4b5563;">${escapeHtml(payload.narrative.summary)}</p>

      <section style="margin-bottom:20px;">
        <h2 style="font-size:18px;margin:0 0 8px;">Period</h2>
        <p style="margin:0;">${escapeHtml(payload.period.label)} · ${escapeHtml(payload.reportType)} summary</p>
        <p style="margin:0;color:#4b5563;">Generated at ${escapeHtml(payload.generator.generatedAt)}</p>
      </section>

      <section style="margin-bottom:20px;">
        <h2 style="font-size:18px;margin:0 0 12px;">KPIs</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Orders</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${payload.kpis.ordersCount}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Gross sales</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(payload.kpis.grossSalesAmount)} ${escapeHtml(args.currencyCode)}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Gross profit before ad spend</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(payload.kpis.grossProfitBeforeAdSpend)} ${escapeHtml(args.currencyCode)}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Gross margin</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatPercentLabel(payload.kpis.grossMarginRate))}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Refund rate</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatPercentLabel(payload.kpis.refundRate))}</td></tr>
            <tr><td style="padding:8px 0;border-top:1px solid #e5e7eb;">Discount rate</td><td style="padding:8px 0;border-top:1px solid #e5e7eb;text-align:right;">${escapeHtml(formatPercentLabel(payload.kpis.discountRate))}</td></tr>
          </tbody>
        </table>
      </section>

      <section style="margin-bottom:20px;">
        <h2 style="font-size:18px;margin:0 0 12px;">Highlights</h2>
        <ul style="padding-left:20px;margin:0;">${renderBulletList(payload.highlights)}</ul>
      </section>

      <section style="margin-bottom:20px;">
        <h2 style="font-size:18px;margin:0 0 12px;">Watchouts</h2>
        <ul style="padding-left:20px;margin:0;">${renderBulletList(payload.watchouts)}</ul>
      </section>

      <section>
        <h2 style="font-size:18px;margin:0 0 12px;">Top alerts</h2>
        <ul style="padding-left:20px;margin:0;">${topAlertsSection}</ul>
      </section>
    </main>
  </body>
</html>`;
  }

  if (args.format === "share_image") {
    return buildReportShareImageSvg({
      currencyCode: args.currencyCode,
      snapshot: args.snapshot,
    });
  }

  const topAlertsSection =
    payload.topAlerts.length > 0
      ? payload.topAlerts
          .map(
            (alert) =>
              `- [${alert.severity}] ${alert.title} (${alert.alertType})${
                alert.impactAmount ? ` · Impact ${alert.impactAmount} ${alert.currencyCode ?? args.currencyCode}` : ""
              }`,
          )
          .join("\n")
      : "- No alerts included in this report window.";

  const highlightsSection = payload.highlights.map((highlight) => `- ${highlight}`).join("\n");
  const watchoutsSection = payload.watchouts.map((watchout) => `- ${watchout}`).join("\n");

  return `# ${payload.narrative.headline}

${payload.narrative.summary}

## Period

- Type: ${payload.reportType}
- Window: ${payload.period.label}
- Generated at: ${payload.generator.generatedAt}

## KPIs

- Orders: ${payload.kpis.ordersCount}
- Gross sales: ${payload.kpis.grossSalesAmount} ${args.currencyCode}
- Gross profit before ad spend: ${payload.kpis.grossProfitBeforeAdSpend} ${args.currencyCode}
- Gross margin: ${payload.kpis.grossMarginRate ?? "not available"}
- Refund rate: ${payload.kpis.refundRate ?? "not available"}
- Discount rate: ${payload.kpis.discountRate ?? "not available"}
- Product cost: ${payload.kpis.productCostAmount} ${args.currencyCode}

## Health

- Score: ${payload.health.score == null ? "not available" : `${payload.health.score} (${payload.health.levelLabel ?? "Unknown"})`}
- Completeness: ${payload.health.completenessLevel ?? "not available"}
- Variant coverage: ${payload.health.variantCoverageRate ?? "not available"}
- Order coverage: ${payload.health.orderCoverageRate ?? "not available"}

## Highlights

${highlightsSection}

## Watchouts

${watchoutsSection}

## Top Alerts

${topAlertsSection}
`;
}

async function getShopRecord(shopDomain: string) {
  return db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      currencyCode: true,
      id: true,
      shopDomain: true,
      shopName: true,
    },
  });
}

async function resolveReportPeriod(shopId: string, reportType: ReportType) {
  const latestMetric = await db.dailyShopMetric.findFirst({
    where: {
      shopId,
    },
    orderBy: {
      metricDate: "desc",
    },
    select: {
      metricDate: true,
    },
  });

  if (!latestMetric) {
    throw new Error("Generate daily metrics first before creating reports.");
  }

  const periodEnd = latestMetric.metricDate;
  const periodStart = reportType === ReportType.DAILY ? periodEnd : addDays(periodEnd, -6);

  return {
    periodEnd,
    periodStart,
  };
}

async function loadReportInputs(args: {
  periodEnd: Date;
  periodStart: Date;
  shopId: string;
}) {
  const [metrics, completeness, health, alerts] = await Promise.all([
    db.dailyShopMetric.findMany({
      where: {
        shopId: args.shopId,
        metricDate: {
          gte: args.periodStart,
          lte: args.periodEnd,
        },
      },
      orderBy: {
        metricDate: "asc",
      },
    }),
    db.dataCompletenessSnapshot.findFirst({
      where: {
        shopId: args.shopId,
        snapshotDate: {
          lte: args.periodEnd,
        },
      },
      orderBy: {
        snapshotDate: "desc",
      },
    }),
    db.profitHealthScore.findFirst({
      where: {
        shopId: args.shopId,
        scoreDate: {
          lte: args.periodEnd,
        },
      },
      orderBy: {
        scoreDate: "desc",
      },
    }),
    db.alert.findMany({
      where: {
        shopId: args.shopId,
        detectedForDate: {
          gte: args.periodStart,
          lte: args.periodEnd,
        },
      },
      orderBy: [
        {
          rankScore: "desc",
        },
        {
          detectedForDate: "desc",
        },
      ],
      take: 5,
    }),
  ]);

  return {
    alerts: alerts.map((alert) => ({
      alertType: alert.alertType,
      currencyCode: alert.currencyCode,
      detectedForDate: alert.detectedForDate,
      impactAmount: alert.impactAmount == null ? null : normalizeNumber(alert.impactAmount),
      severity: alert.severity,
      status: alert.status,
      title: alert.title,
    })),
    completeness: completeness
      ? {
          level: completeness.level,
          orderCoverageRate: completeness.orderCoverageRate == null ? null : normalizeNumber(completeness.orderCoverageRate),
          snapshotDate: completeness.snapshotDate,
          variantCoverageRate: completeness.variantCoverageRate == null ? null : normalizeNumber(completeness.variantCoverageRate),
        }
      : null,
    health: health
      ? {
          levelLabel: health.levelLabel,
          score: health.score,
          scoreDate: health.scoreDate,
        }
      : null,
    metrics: metrics.map((metric) => ({
      completenessLevel: metric.completenessLevel,
      discountAmount: normalizeNumber(metric.discountAmount),
      discountRate: metric.discountRate == null ? null : normalizeNumber(metric.discountRate),
      grossMarginRate: metric.grossMarginRate == null ? null : normalizeNumber(metric.grossMarginRate),
      grossProfitBeforeAdSpend: normalizeNumber(metric.grossProfitBeforeAdSpend),
      grossSalesAmount: normalizeNumber(metric.grossSalesAmount),
      metricDate: metric.metricDate,
      ordersCount: metric.ordersCount,
      productCostAmount: normalizeNumber(metric.productCostAmount),
      refundAmount: normalizeNumber(metric.refundAmount),
      refundRate: metric.refundRate == null ? null : normalizeNumber(metric.refundRate),
      shippingCostEstimateAmount: normalizeNumber(metric.shippingCostEstimateAmount),
      shippingRevenueAmount: normalizeNumber(metric.shippingRevenueAmount),
      transactionFeeEstimateAmount: normalizeNumber(metric.transactionFeeEstimateAmount),
    })),
  };
}

function toStoredSnapshot(snapshot: {
  aiArtifactId: string | null;
  createdAt: Date;
  id: string;
  payload: unknown;
  periodEnd: Date;
  periodStart: Date;
  reportType: ReportType;
  updatedAt: Date;
}): StoredReportSnapshot {
  return {
    aiArtifactId: snapshot.aiArtifactId,
    createdAt: snapshot.createdAt.toISOString(),
    id: snapshot.id,
    payload: snapshot.payload as ReportPayload,
    periodEnd: snapshot.periodEnd.toISOString(),
    periodStart: snapshot.periodStart.toISOString(),
    reportType: snapshot.reportType,
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

function toStoredDigestDelivery(delivery: {
  attemptCount: number;
  createdAt: Date;
  deliveredAt: Date | null;
  exportFormat: string;
  id: string;
  lastAttemptAt: Date | null;
  lastError: string | null;
  recipientEmail: string;
  reportSnapshotId: string | null;
  reportType: ReportType;
  status: string;
  subject: string;
  updatedAt: Date;
}): StoredDigestDelivery {
  return {
    attemptCount: delivery.attemptCount,
    createdAt: delivery.createdAt.toISOString(),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    exportFormat: delivery.exportFormat,
    id: delivery.id,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    lastError: delivery.lastError,
    recipientEmail: delivery.recipientEmail,
    reportSnapshotId: delivery.reportSnapshotId,
    reportType: delivery.reportType,
    status: delivery.status,
    subject: delivery.subject,
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

function toDateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function isSnapshotCurrentForMetricDate(args: {
  latestMetricDate: Date | null;
  snapshot: {
    periodEnd: Date | string;
  } | null;
}) {
  if (!args.latestMetricDate || !args.snapshot) {
    return false;
  }

  return toDateKey(args.latestMetricDate) === toDateKey(args.snapshot.periodEnd);
}

export async function generateReportSnapshot(args: {
  reportType: ReportType;
  shopDomain: string;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const { periodEnd, periodStart } = await resolveReportPeriod(shop.id, args.reportType);
  const inputs = await loadReportInputs({
    periodEnd,
    periodStart,
    shopId: shop.id,
  });

  const fallbackPayload = buildFallbackReportPayload({
    alerts: inputs.alerts,
    completeness: inputs.completeness,
    currencyCode: shop.currencyCode ?? "USD",
    health: inputs.health,
    metrics: inputs.metrics,
    periodEnd,
    periodStart,
    reportType: args.reportType,
  });
  let payload = fallbackPayload;
  let artifactErrorMessage: string | null = null;
  let artifactFallbackUsed = true;
  let artifactModelName = fallbackPayload.generator.modelName;
  let artifactProvider = fallbackPayload.generator.provider;
  let artifactStatus: "FALLBACK" | "GENERATED" = "FALLBACK";

  try {
    const aiNarrative = await generateAiNarrative(fallbackPayload);

    if (aiNarrative) {
      payload = {
        ...fallbackPayload,
        generator: {
          fallbackUsed: false,
          generatedAt: fallbackPayload.generator.generatedAt,
          mode: "openai-assisted",
          modelName: aiNarrative.modelName,
          provider: aiNarrative.provider,
        },
        highlights: aiNarrative.highlights,
        narrative: {
          headline: aiNarrative.headline,
          summary: aiNarrative.summary,
        },
        watchouts: aiNarrative.watchouts,
      };
      artifactFallbackUsed = false;
      artifactModelName = aiNarrative.modelName;
      artifactProvider = aiNarrative.provider;
      artifactStatus = "GENERATED";
    }
  } catch (error) {
    artifactErrorMessage = error instanceof Error ? error.message : String(error);
  }

  const referenceKey = getReportReferenceKey(args.reportType, periodStart, periodEnd);
  const inputHash = buildInputHash({
    alerts: inputs.alerts,
    completeness: inputs.completeness,
    health: inputs.health,
    metrics: inputs.metrics,
    reportType: args.reportType,
  });
  const artifactType = getArtifactTypeForReport(args.reportType);
  const expiresAt = args.reportType === ReportType.DAILY ? addDays(periodEnd, 1) : addDays(periodEnd, 7);

  const aiArtifact = await db.aiArtifact.upsert({
    where: {
      shopId_artifactType_referenceKey_inputHash: {
        artifactType,
        inputHash,
        referenceKey,
        shopId: shop.id,
      },
    },
    create: {
      artifactType,
      expiresAt,
      errorMessage: artifactErrorMessage,
      fallbackUsed: artifactFallbackUsed,
      generatedAt: new Date(payload.generator.generatedAt),
      inputHash,
      modelName: artifactModelName,
      outputJson: payload,
      provider: artifactProvider,
      referenceKey,
      shopId: shop.id,
      status: artifactStatus,
    },
    update: {
      errorMessage: artifactErrorMessage,
      expiresAt,
      fallbackUsed: artifactFallbackUsed,
      generatedAt: new Date(payload.generator.generatedAt),
      modelName: artifactModelName,
      outputJson: payload,
      provider: artifactProvider,
      status: artifactStatus,
    },
  });

  const snapshot = await db.reportSnapshot.upsert({
    where: {
      shopId_reportType_periodStart_periodEnd: {
        periodEnd,
        periodStart,
        reportType: args.reportType,
        shopId: shop.id,
      },
    },
    create: {
      aiArtifactId: aiArtifact.id,
      payload,
      periodEnd,
      periodStart,
      reportType: args.reportType,
      shopId: shop.id,
    },
    update: {
      aiArtifactId: aiArtifact.id,
      payload,
    },
  });

  return {
    currencyCode: shop.currencyCode ?? "USD",
    snapshot: toStoredSnapshot(snapshot),
  };
}

export async function createReportExportRecord(args: {
  exportFormat: ReportExportFormat;
  reportType: ReportType;
  shopId: string;
  snapshotId: string;
}) {
  return db.reportExport.create({
    data: {
      exportFormat: args.exportFormat,
      reportType: args.reportType,
      shopId: args.shopId,
      status: "GENERATED",
      storageKey: `inline://report-snapshot/${args.snapshotId}/${args.exportFormat}/${Date.now()}`,
    },
  });
}

export async function getReportsOverview(shopDomain: string) {
  const shop = await getShopRecord(shopDomain);

  if (!shop) {
    return null;
  }

  const [latestMetric, dailyReportRecord, weeklyReportRecord, recentExports, recentDigestDeliveries] = await Promise.all([
    db.dailyShopMetric.findFirst({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        metricDate: "desc",
      },
      select: {
        metricDate: true,
      },
    }),
    db.reportSnapshot.findFirst({
      where: {
        reportType: ReportType.DAILY,
        shopId: shop.id,
      },
      orderBy: {
        periodEnd: "desc",
      },
    }),
    db.reportSnapshot.findFirst({
      where: {
        reportType: ReportType.WEEKLY,
        shopId: shop.id,
      },
      orderBy: {
        periodEnd: "desc",
      },
    }),
    db.reportExport.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),
    db.digestDelivery.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 12,
    }),
  ]);

  let dailyReport = dailyReportRecord ? toStoredSnapshot(dailyReportRecord) : null;
  let weeklyReport = weeklyReportRecord ? toStoredSnapshot(weeklyReportRecord) : null;

  if (
    latestMetric &&
    !isSnapshotCurrentForMetricDate({
      latestMetricDate: latestMetric.metricDate,
      snapshot: dailyReport,
    })
  ) {
    dailyReport = (
      await generateReportSnapshot({
        reportType: ReportType.DAILY,
        shopDomain,
      })
    ).snapshot;
  }

  if (
    latestMetric &&
    !isSnapshotCurrentForMetricDate({
      latestMetricDate: latestMetric.metricDate,
      snapshot: weeklyReport,
    })
  ) {
    weeklyReport = (
      await generateReportSnapshot({
        reportType: ReportType.WEEKLY,
        shopDomain,
      })
    ).snapshot;
  }

  return {
    currencyCode: shop.currencyCode ?? "USD",
    dailyReport,
    latestMetricDate: latestMetric?.metricDate.toISOString() ?? null,
    recentExports: recentExports.map((reportExport) => ({
      createdAt: reportExport.createdAt.toISOString(),
      exportFormat: reportExport.exportFormat,
      id: reportExport.id,
      reportType: reportExport.reportType,
      status: reportExport.status,
      storageKey: reportExport.storageKey,
    })),
    recentDigestDeliveries: recentDigestDeliveries.map(toStoredDigestDelivery),
    shopId: shop.id,
    shopName: shop.shopName ?? shop.shopDomain,
    weeklyReport,
  };
}

export async function prepareDigestDeliveries(args: {
  reportType: ReportType;
  shopDomain: string;
}) {
  const { snapshot } = await generateReportSnapshot(args);
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const notificationPreference = await db.notificationPreference.findUnique({
    where: {
      shopId: shop.id,
    },
  });

  const reportEnabled =
    args.reportType === ReportType.DAILY
      ? notificationPreference?.dailySummaryEnabled ?? true
      : notificationPreference?.weeklySummaryEnabled ?? true;

  if (!reportEnabled) {
    throw new Error(`${args.reportType} digest is currently disabled in notification preferences.`);
  }

  const recipients = getNotificationRecipients(notificationPreference?.recipientEmails);
  if (recipients.length === 0) {
    throw new Error("Add at least one digest recipient in Settings before preparing deliveries.");
  }

  const subject = buildDigestDeliverySubject({
    periodLabel: snapshot.payload.period.label,
    reportType: snapshot.reportType,
  });

  const deliveries = await db.$transaction(
    recipients.map((recipientEmail) =>
      db.digestDelivery.upsert({
        where: {
          shopId_reportSnapshotId_recipientEmail_exportFormat: {
            exportFormat: "email_text",
            recipientEmail,
            reportSnapshotId: snapshot.id,
            shopId: shop.id,
          },
        },
        create: {
          attemptCount: 0,
          deliveryChannel: "EMAIL",
          exportFormat: "email_text",
          metadata: {
            replyToEmail: notificationPreference?.replyToEmail ?? null,
            timezoneOverride: notificationPreference?.timezoneOverride ?? null,
          },
          recipientEmail,
          reportSnapshotId: snapshot.id,
          reportType: args.reportType,
          shopId: shop.id,
          status: "PREPARED",
          subject,
        },
        update: {
          deliveredAt: null,
          lastError: null,
          metadata: {
            replyToEmail: notificationPreference?.replyToEmail ?? null,
            timezoneOverride: notificationPreference?.timezoneOverride ?? null,
          },
          status: "PREPARED",
          subject,
        },
      }),
    ),
  );

  return {
    preparedCount: deliveries.length,
    deliveries: deliveries.map(toStoredDigestDelivery),
    snapshot,
  };
}

export async function transitionDigestDelivery(args: {
  deliveryId: string;
  errorMessage?: string | null;
  shopDomain: string;
  status: "FAILED" | "PREPARED" | "SENT";
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const existing = await db.digestDelivery.findFirst({
    where: {
      id: args.deliveryId,
      shopId: shop.id,
    },
  });

  if (!existing) {
    throw new Error("Digest delivery record not found.");
  }

  const nextAttemptCount =
    args.status === "FAILED" || args.status === "SENT" ? existing.attemptCount + 1 : existing.attemptCount;
  const now = new Date();

  const updated = await db.digestDelivery.update({
    where: {
      id: existing.id,
    },
    data: {
      attemptCount: nextAttemptCount,
      deliveredAt: args.status === "SENT" ? now : null,
      lastAttemptAt: args.status === "FAILED" || args.status === "SENT" ? now : existing.lastAttemptAt,
      lastError: args.status === "FAILED" ? args.errorMessage ?? "Digest delivery failed." : null,
      status: args.status,
    },
  });

  return toStoredDigestDelivery(updated);
}

export async function buildReportExportResponse(args: {
  exportFormat: string;
  reportType: ReportType;
  shopDomain: string;
}) {
  const exportFormat = resolveReportExportFormat(args.exportFormat);

  if (!exportFormat) {
    throw new Error("Unsupported report export format.");
  }

  const { currencyCode, snapshot } = await generateReportSnapshot({
    reportType: args.reportType,
    shopDomain: args.shopDomain,
  });
  const overview = await getReportsOverview(args.shopDomain);

  if (!overview) {
    throw new Error("Shop record not found.");
  }

  await createReportExportRecord({
    exportFormat,
    reportType: args.reportType,
    shopId: overview.shopId,
    snapshotId: snapshot.id,
  });

  const reportContent =
    exportFormat === "pdf"
      ? await buildReportPdfContent({
          currencyCode,
          snapshot,
        })
      : renderReportExportContent({
          currencyCode,
          format: exportFormat,
          snapshot,
        });
  const extension =
    exportFormat === "markdown"
      ? "md"
      : exportFormat === "email_text"
        ? "txt"
        : exportFormat === "share_image"
          ? "svg"
          : exportFormat;
  const contentType =
    exportFormat === "json"
      ? "application/json; charset=utf-8"
      : exportFormat === "csv"
        ? "text/csv; charset=utf-8"
        : exportFormat === "html"
          ? "text/html; charset=utf-8"
          : exportFormat === "email_text"
            ? "text/plain; charset=utf-8"
            : exportFormat === "pdf"
              ? "application/pdf"
              : exportFormat === "share_image"
                ? "image/svg+xml; charset=utf-8"
            : "text/markdown; charset=utf-8";
  const fileName = `profit-guard-${args.reportType.toLowerCase()}-${snapshot.periodEnd.slice(0, 10)}.${extension}`;
  const responseBody =
    typeof reportContent === "string"
      ? reportContent
      : new Uint8Array(reportContent).buffer;

  return new Response(responseBody, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": contentType,
    },
  });
}
