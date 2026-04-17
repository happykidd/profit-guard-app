import { ReportType } from "@prisma/client";
import prisma from "../../../../packages/db/src/client";
import { sendExternalEmail, isEmailDeliveryReady } from "../../../web/app/services/email-delivery.server";
import {
  prepareDigestDeliveries,
  renderReportExportContent,
  transitionDigestDelivery,
  type StoredReportSnapshot,
} from "../../../web/app/services/reports.server";

const DEFAULT_DIGEST_INTERVAL_MS = 60_000;
const DEFAULT_DIGEST_DELIVERY_LIMIT = 20;
const WEEKLY_DIGEST_DAY = "MON";

const recentScheduleKeys = new Set<string>();

type NotificationPreferenceRecord = {
  alertDigestEnabled: boolean;
  dailySummaryEnabled: boolean;
  preferredSendHour: number;
  shop: {
    currencyCode: string | null;
    ianaTimezone: string | null;
    shopDomain: string;
  };
  shopId: string;
  timezoneOverride: string | null;
  weeklySummaryEnabled: boolean;
};

type DueDigestType = "DAILY" | "WEEKLY";

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function getDigestIntervalMs() {
  const parsed = Number(process.env.WORKER_DIGEST_INTERVAL_MS ?? DEFAULT_DIGEST_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : DEFAULT_DIGEST_INTERVAL_MS;
}

function getDigestDeliveryLimit() {
  const parsed = Number(process.env.WORKER_DIGEST_DELIVERY_LIMIT ?? DEFAULT_DIGEST_DELIVERY_LIMIT);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_DIGEST_DELIVERY_LIMIT;
}

function getLocalTimeParts(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );

  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour ?? 0),
    weekday: String(parts.weekday ?? "").toUpperCase(),
  };
}

export function resolveDueDigestTypes(args: {
  dailySummaryEnabled: boolean;
  now: Date;
  preferredSendHour: number;
  timeZone: string;
  weeklySummaryEnabled: boolean;
}) {
  const { localHour, weekday } = getLocalTimeParts(args.now, args.timeZone);
  const dueTypes: DueDigestType[] = [];

  if (localHour !== args.preferredSendHour) {
    return dueTypes;
  }

  if (args.dailySummaryEnabled) {
    dueTypes.push("DAILY");
  }

  if (args.weeklySummaryEnabled && weekday === WEEKLY_DIGEST_DAY) {
    dueTypes.push("WEEKLY");
  }

  return dueTypes;
}

function getScheduleKey(args: {
  localDate: string;
  localHour: number;
  reportType: DueDigestType;
  shopId: string;
}) {
  return `${args.shopId}:${args.reportType}:${args.localDate}:${args.localHour}`;
}

function stripDigestSubjectLine(value: string) {
  return value.replace(/^Subject:.*\n\n/, "");
}

function extractReplyTo(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const replyToEmail = (metadata as Record<string, unknown>).replyToEmail;
  return typeof replyToEmail === "string" && replyToEmail.trim().length > 0 ? replyToEmail : null;
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
    payload: snapshot.payload as StoredReportSnapshot["payload"],
    periodEnd: snapshot.periodEnd.toISOString(),
    periodStart: snapshot.periodStart.toISOString(),
    reportType: snapshot.reportType,
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

async function prepareScheduledDigestDeliveries(now: Date) {
  if (process.env.PROFIT_GUARD_ENABLE_DIGEST_SCHEDULER !== "true") {
    return {
      preparedCount: 0,
      scheduledShops: 0,
    };
  }

  const preferences = await prisma.notificationPreference.findMany({
    where: {
      shop: {
        isActive: true,
      },
    },
    select: {
      alertDigestEnabled: true,
      dailySummaryEnabled: true,
      preferredSendHour: true,
      shop: {
        select: {
          currencyCode: true,
          ianaTimezone: true,
          shopDomain: true,
        },
      },
      shopId: true,
      timezoneOverride: true,
      weeklySummaryEnabled: true,
    },
  });

  let preparedCount = 0;
  let scheduledShops = 0;

  for (const preference of preferences satisfies NotificationPreferenceRecord[]) {
    const timeZone = preference.timezoneOverride || preference.shop.ianaTimezone || "UTC";
    const dueTypes = resolveDueDigestTypes({
      dailySummaryEnabled: preference.dailySummaryEnabled,
      now,
      preferredSendHour: preference.preferredSendHour,
      timeZone,
      weeklySummaryEnabled: preference.weeklySummaryEnabled,
    });

    if (dueTypes.length === 0) {
      continue;
    }

    const { localDate, localHour } = getLocalTimeParts(now, timeZone);
    let shopScheduled = false;

    for (const reportType of dueTypes) {
      const scheduleKey = getScheduleKey({
        localDate,
        localHour,
        reportType,
        shopId: preference.shopId,
      });

      if (recentScheduleKeys.has(scheduleKey)) {
        continue;
      }

      try {
        const result = await prepareDigestDeliveries({
          reportType: reportType === "DAILY" ? ReportType.DAILY : ReportType.WEEKLY,
          shopDomain: preference.shop.shopDomain,
        });
        preparedCount += result.preparedCount;
        recentScheduleKeys.add(scheduleKey);
        shopScheduled = true;
      } catch (error) {
        console.warn("[worker] Digest preparation skipped", {
          error: error instanceof Error ? error.message : String(error),
          reportType,
          shop: preference.shop.shopDomain,
        });
      }
    }

    if (shopScheduled) {
      scheduledShops += 1;
    }
  }

  return {
    preparedCount,
    scheduledShops,
  };
}

async function processPreparedDigestDeliveries(limit = getDigestDeliveryLimit()) {
  if (!isEmailDeliveryReady()) {
    return {
      failedCount: 0,
      processedCount: 0,
      sentCount: 0,
      skippedReason: "provider_not_ready",
    };
  }

  const deliveries = await prisma.digestDelivery.findMany({
    where: {
      status: "PREPARED",
      shop: {
        isActive: true,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
    include: {
      reportSnapshot: true,
      shop: {
        select: {
          currencyCode: true,
          shopDomain: true,
        },
      },
    },
  });

  let sentCount = 0;
  let failedCount = 0;

  for (const delivery of deliveries) {
    if (!delivery.reportSnapshot) {
      await transitionDigestDelivery({
        deliveryId: delivery.id,
        errorMessage: "Digest delivery is missing its report snapshot.",
        shopDomain: delivery.shop.shopDomain,
        status: "FAILED",
      });
      failedCount += 1;
      continue;
    }

    const snapshot = toStoredSnapshot(delivery.reportSnapshot);
    const textBody = stripDigestSubjectLine(
      renderReportExportContent({
        currencyCode: delivery.shop.currencyCode ?? "USD",
        format: "email_text",
        snapshot,
      }),
    );
    const htmlBody = renderReportExportContent({
      currencyCode: delivery.shop.currencyCode ?? "USD",
      format: "html",
      snapshot,
    });

    try {
      const providerResult = await sendExternalEmail({
        html: htmlBody,
        idempotencyKey: delivery.id,
        replyTo: extractReplyTo(delivery.metadata),
        subject: delivery.subject,
        text: textBody,
        to: [delivery.recipientEmail],
      });

      await prisma.digestDelivery.update({
        where: {
          id: delivery.id,
        },
        data: {
          metadata: toJsonValue({
            ...(delivery.metadata && typeof delivery.metadata === "object" ? delivery.metadata : {}),
            provider: providerResult.provider,
            providerMessageId: providerResult.providerMessageId,
            providerResponse: providerResult.raw,
          }),
        },
      });

      await transitionDigestDelivery({
        deliveryId: delivery.id,
        shopDomain: delivery.shop.shopDomain,
        status: "SENT",
      });
      sentCount += 1;
    } catch (error) {
      await transitionDigestDelivery({
        deliveryId: delivery.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        shopDomain: delivery.shop.shopDomain,
        status: "FAILED",
      });
      failedCount += 1;
    }
  }

  return {
    failedCount,
    processedCount: deliveries.length,
    sentCount,
    skippedReason: null,
  };
}

export async function runDigestDispatchCycle(args?: {
  deliveryLimit?: number;
  now?: Date;
}) {
  const now = args?.now ?? new Date();
  const prepared = await prepareScheduledDigestDeliveries(now);
  const processed = await processPreparedDigestDeliveries(args?.deliveryLimit ?? getDigestDeliveryLimit());

  return {
    ...processed,
    preparedCount: prepared.preparedCount,
    scheduledShops: prepared.scheduledShops,
  };
}

export function getDigestDispatchConfig() {
  return {
    deliveryLimit: getDigestDeliveryLimit(),
    intervalMs: getDigestIntervalMs(),
    schedulerEnabled: process.env.PROFIT_GUARD_ENABLE_DIGEST_SCHEDULER === "true",
  };
}
