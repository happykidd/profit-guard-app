import {
  AlertSeverity,
  AlertStatus,
  FeedbackValue,
  SavedViewVisibility,
} from "@prisma/client";
import db from "../db.server";
import { getAlertExplanation } from "./alert-ai.server";
import { buildAlertBrief } from "./alert-playbooks.server";

const ACTIVE_ALERT_STATUSES = [AlertStatus.NEW, AlertStatus.READ] as const;
const CLOSED_ALERT_STATUSES = [AlertStatus.RESOLVED, AlertStatus.IGNORED] as const;
const ALERT_SEVERITY_VALUES = ["ALL", "MEDIUM", "HIGH", "CRITICAL"] as const;
const ALERT_QUEUE_VALUES = ["ALL", "ACTIVE", "CLOSED"] as const;
const ALERT_WORKFLOW_INTENTS = ["assign_owner", "assign_reviewer", "mark_reviewed"] as const;
const SAVED_VIEW_VISIBILITY_VALUES = ["PRIVATE", "SHARED"] as const;

type AlertSeverityFilter = (typeof ALERT_SEVERITY_VALUES)[number];
type AlertQueueFilter = (typeof ALERT_QUEUE_VALUES)[number];
type AlertSavedViewVisibility = (typeof SAVED_VIEW_VISIBILITY_VALUES)[number];

type AlertFilters = {
  alertType: string;
  entityType: string;
  queue: AlertQueueFilter;
  search: string;
  severity: AlertSeverityFilter;
};

type AlertWorkflowIntent = (typeof ALERT_WORKFLOW_INTENTS)[number];

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

function isActiveAlertStatus(status: AlertStatus) {
  return status === AlertStatus.NEW || status === AlertStatus.READ;
}

function toAlertSummary(alert: {
  id: string;
  threadId: string | null;
  alertType: string;
  severity: string;
  status: string;
  entityType: string;
  entityKey: string;
  title: string;
  impactAmount: { toString(): string } | null;
  currencyCode: string | null;
  confidenceLevel: string;
  completenessLevel: string;
  detectedForDate: Date;
  createdAt: Date;
  rulePayload?: unknown;
}) {
  return {
    id: alert.id,
    threadId: alert.threadId,
    alertType: alert.alertType,
    severity: alert.severity,
    status: alert.status,
    entityType: alert.entityType,
    entityKey: alert.entityKey,
    title: alert.title,
    impactAmount: alert.impactAmount?.toString() ?? null,
    currencyCode: alert.currencyCode,
    confidenceLevel: alert.confidenceLevel,
    completenessLevel: alert.completenessLevel,
    detectedForDate: alert.detectedForDate.toISOString(),
    createdAt: alert.createdAt.toISOString(),
    brief: buildAlertBrief({
      alertType: alert.alertType,
      completenessLevel: alert.completenessLevel,
      confidenceLevel: alert.confidenceLevel,
      currencyCode: alert.currencyCode,
      entityKey: alert.entityKey,
      entityType: alert.entityType,
      impactAmount: alert.impactAmount?.toString() ?? null,
      rulePayload: alert.rulePayload,
      severity: alert.severity,
      title: alert.title,
    }),
  };
}

export function resolveAlertStatusIntent(intent: string) {
  switch (intent) {
    case "mark_read":
      return AlertStatus.READ;
    case "resolve":
      return AlertStatus.RESOLVED;
    case "ignore":
      return AlertStatus.IGNORED;
    case "reopen":
      return AlertStatus.NEW;
    default:
      return null;
  }
}

export function resolveAlertFeedbackIntent(intent: string) {
  switch (intent) {
    case "feedback_useful":
      return FeedbackValue.USEFUL;
    case "feedback_not_useful":
      return FeedbackValue.NOT_USEFUL;
    default:
      return null;
  }
}

export function resolveAlertWorkflowIntent(intent: string): AlertWorkflowIntent | null {
  return ALERT_WORKFLOW_INTENTS.includes(intent as AlertWorkflowIntent)
    ? (intent as AlertWorkflowIntent)
    : null;
}

export function resolveAlertSavedViewVisibility(value: string): AlertSavedViewVisibility {
  const normalizedValue = value.trim().toUpperCase();
  return SAVED_VIEW_VISIBILITY_VALUES.includes(normalizedValue as AlertSavedViewVisibility)
    ? (normalizedValue as AlertSavedViewVisibility)
    : "PRIVATE";
}

export function resolveAlertFilters(searchParams: URLSearchParams): AlertFilters {
  const rawQueue = (searchParams.get("queue") || "ALL").trim().toUpperCase();
  const rawSeverity = (searchParams.get("severity") || "ALL").trim().toUpperCase();
  const queue = ALERT_QUEUE_VALUES.includes(rawQueue as AlertQueueFilter)
    ? (rawQueue as AlertQueueFilter)
    : "ALL";
  const severity = ALERT_SEVERITY_VALUES.includes(rawSeverity as AlertSeverityFilter)
    ? (rawSeverity as AlertSeverityFilter)
    : "ALL";

  return {
    alertType: (searchParams.get("alertType") || "ALL").trim() || "ALL",
    entityType: (searchParams.get("entityType") || "ALL").trim().toUpperCase() || "ALL",
    queue,
    search: (searchParams.get("search") || "").trim(),
    severity,
  };
}

export function buildAlertFiltersSearchParams(filters: AlertFilters) {
  const searchParams = new URLSearchParams();

  if (filters.queue !== "ALL") {
    searchParams.set("queue", filters.queue);
  }

  if (filters.severity !== "ALL") {
    searchParams.set("severity", filters.severity);
  }

  if (filters.alertType !== "ALL") {
    searchParams.set("alertType", filters.alertType);
  }

  if (filters.entityType !== "ALL") {
    searchParams.set("entityType", filters.entityType);
  }

  if (filters.search) {
    searchParams.set("search", filters.search);
  }

  return searchParams;
}

export function buildAlertFiltersHref(filters: AlertFilters) {
  const searchParams = buildAlertFiltersSearchParams(filters);
  const query = searchParams.toString();
  return query ? `/app/alerts?${query}` : "/app/alerts";
}

async function getShopRecord(shopDomain: string) {
  return db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      id: true,
      currencyCode: true,
      shopDomain: true,
    },
  });
}

async function refreshAlertThreadState(tx: TransactionClient, threadId: string) {
  const alerts = await tx.alert.findMany({
    where: {
      threadId,
    },
    select: {
      detectedForDate: true,
      status: true,
    },
    orderBy: {
      detectedForDate: "asc",
    },
  });

  if (alerts.length === 0) {
    await tx.alertThread.delete({
      where: {
        id: threadId,
      },
    });
    return;
  }

  await tx.alertThread.update({
    where: {
      id: threadId,
    },
    data: {
      firstDetectedAt: alerts[0]?.detectedForDate ?? new Date(),
      lastDetectedAt: alerts[alerts.length - 1]?.detectedForDate ?? new Date(),
      isOpen: alerts.some((alert) => isActiveAlertStatus(alert.status)),
    },
  });
}

function buildSearchWhere(search: string) {
  const trimmedSearch = search.trim();

  if (!trimmedSearch) {
    return undefined;
  }

  return {
    OR: [
      {
        title: {
          contains: trimmedSearch,
          mode: "insensitive" as const,
        },
      },
      {
        entityKey: {
          contains: trimmedSearch,
          mode: "insensitive" as const,
        },
      },
      {
        alertType: {
          contains: trimmedSearch,
          mode: "insensitive" as const,
        },
      },
      {
        entityType: {
          contains: trimmedSearch,
          mode: "insensitive" as const,
        },
      },
    ],
  };
}

function buildAlertFiltersWhere(filters: AlertFilters) {
  return {
    ...(filters.alertType !== "ALL"
      ? {
          alertType: filters.alertType,
        }
      : {}),
    ...(filters.entityType !== "ALL"
      ? {
          entityType: filters.entityType,
        }
      : {}),
    ...(filters.severity !== "ALL"
      ? {
          severity: filters.severity as AlertSeverity,
        }
      : {}),
    ...buildSearchWhere(filters.search),
  };
}

function getEligibleStatusesForTransition(nextStatus: AlertStatus) {
  return nextStatus === AlertStatus.NEW
    ? [...CLOSED_ALERT_STATUSES]
    : [...ACTIVE_ALERT_STATUSES];
}

async function applyAlertStatusTransition(args: {
  tx: TransactionClient;
  alerts: Array<{
    id: string;
    status: AlertStatus;
    threadId: string | null;
  }>;
  nextStatus: AlertStatus;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  let updatedCount = 0;
  const threadIds = new Set<string>();

  for (const alert of args.alerts) {
    if (alert.status === args.nextStatus) {
      continue;
    }

    await args.tx.alert.update({
      where: {
        id: alert.id,
      },
      data: {
        status: args.nextStatus,
      },
    });

    await args.tx.alertStatusHistory.create({
      data: {
        alertId: alert.id,
        fromStatus: alert.status,
        toStatus: args.nextStatus,
        note: args.note?.trim() || null,
        actorType: args.actorType ?? "merchant_admin",
        actorId: args.actorId ?? null,
      },
    });

    if (alert.threadId) {
      threadIds.add(alert.threadId);
    }

    updatedCount += 1;
  }

  for (const threadId of threadIds) {
    await refreshAlertThreadState(args.tx, threadId);
  }

  return {
    status: args.nextStatus,
    updatedCount,
  };
}

export async function getAlertsOverview(args: {
  shopDomain: string;
  filters: AlertFilters;
}) {
  const { filters } = args;
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    return null;
  }

  const filterWhere = buildAlertFiltersWhere(filters);
  const shouldLoadActiveQueue = filters.queue !== "CLOSED";
  const shouldLoadClosedQueue = filters.queue !== "ACTIVE";

  const [activeAlerts, recentClosedAlerts, openThreadsCount, criticalAlertsCount, openThreads, allEntityTypes, allAlertTypes, savedViews] = await Promise.all([
    shouldLoadActiveQueue
      ? db.alert.findMany({
          where: {
            shopId: shop.id,
            status: {
              in: [...ACTIVE_ALERT_STATUSES],
            },
            ...filterWhere,
          },
          orderBy: [
            {
              rankScore: "desc",
            },
            {
              detectedForDate: "desc",
            },
          ],
          take: 30,
        })
      : Promise.resolve([]),
    shouldLoadClosedQueue
      ? db.alert.findMany({
          where: {
            shopId: shop.id,
            status: {
              in: [...CLOSED_ALERT_STATUSES],
            },
            ...filterWhere,
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: 20,
        })
      : Promise.resolve([]),
    db.alertThread.count({
      where: {
        shopId: shop.id,
        isOpen: true,
      },
    }),
    db.alert.count({
      where: {
        shopId: shop.id,
        status: {
          in: [...ACTIVE_ALERT_STATUSES],
        },
        severity: "CRITICAL",
      },
    }),
    shouldLoadActiveQueue
      ? db.alertThread.findMany({
          where: {
            shopId: shop.id,
            isOpen: true,
          },
          include: {
            alerts: {
              where: {
                status: {
                  in: [...ACTIVE_ALERT_STATUSES],
                },
                ...filterWhere,
              },
              orderBy: [
                {
                  rankScore: "desc",
                },
                {
                  detectedForDate: "desc",
                },
              ],
              take: 20,
            },
          },
          orderBy: {
            lastDetectedAt: "desc",
          },
          take: 20,
        })
      : Promise.resolve([]),
    db.alert.findMany({
      where: {
        shopId: shop.id,
      },
      select: {
        entityType: true,
      },
      distinct: ["entityType"],
      orderBy: {
        entityType: "asc",
      },
    }),
    db.alert.findMany({
      where: {
        shopId: shop.id,
      },
      select: {
        alertType: true,
      },
      distinct: ["alertType"],
      orderBy: {
        alertType: "asc",
      },
    }),
    db.alertSavedView.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          name: "asc",
        },
      ],
    }),
  ]);

  const filteredThreads = openThreads
    .filter((thread) => thread.alerts.length > 0)
    .map((thread) => {
      const latestAlert = thread.alerts[0];
      const criticalCount = thread.alerts.filter((alert) => alert.severity === "CRITICAL").length;

      return {
        alertCount: thread.alerts.length,
        alertType: thread.alertType,
        criticalCount,
        entityKey: thread.entityKey,
        entityType: thread.entityType,
        id: thread.id,
        isOpen: thread.isOpen,
        lastDetectedAt: thread.lastDetectedAt.toISOString(),
        latestAlert: latestAlert ? toAlertSummary(latestAlert) : null,
        ownerAssignedAt: thread.ownerAssignedAt?.toISOString() ?? null,
        ownerName: thread.ownerName,
        reviewedAt: thread.reviewedAt?.toISOString() ?? null,
        reviewerName: thread.reviewerName,
        workflowNote: thread.workflowNote,
      };
    });

  return {
    activeAlerts: activeAlerts.map(toAlertSummary),
    activeThreads: filteredThreads,
    availableAlertTypes: allAlertTypes
      .map((entry) => entry.alertType)
      .filter((alertType): alertType is string => Boolean(alertType)),
    availableEntityTypes: allEntityTypes
      .map((entry) => entry.entityType)
      .filter((entityType): entityType is string => Boolean(entityType)),
    criticalAlertsCount,
    currencyCode: shop.currencyCode ?? "USD",
    filters,
    openThreadsCount,
    recentClosedAlerts: recentClosedAlerts.map(toAlertSummary),
    savedViews: savedViews.map((savedView) => {
      const filtersForView = {
        alertType: savedView.alertType,
        entityType: savedView.entityType,
        queue: savedView.queue as AlertQueueFilter,
        search: savedView.search ?? "",
        severity: savedView.severity as AlertSeverityFilter,
      };

      return {
        alertType: savedView.alertType,
        createdByLabel: savedView.createdByLabel,
        description: savedView.description,
        entityType: savedView.entityType,
        href: buildAlertFiltersHref(filtersForView),
        id: savedView.id,
        isShared: savedView.visibility === SavedViewVisibility.SHARED,
        name: savedView.name,
        queue: savedView.queue,
        search: savedView.search,
        severity: savedView.severity,
        updatedAt: savedView.updatedAt.toISOString(),
        visibility: savedView.visibility,
      };
    }).sort((left, right) => {
      if (left.visibility !== right.visibility) {
        return left.visibility === "SHARED" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    }),
    shopId: shop.id,
  };
}

export async function getAlertDetail(args: {
  shopDomain: string;
  alertId: string;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    return null;
  }

  const alert = await db.alert.findFirst({
    where: {
      id: args.alertId,
      shopId: shop.id,
    },
    include: {
      feedbacks: {
        orderBy: {
          createdAt: "desc",
        },
      },
      statusHistory: {
        orderBy: {
          createdAt: "asc",
        },
      },
      thread: {
        include: {
          alerts: {
            orderBy: {
              detectedForDate: "desc",
            },
            take: 20,
          },
        },
      },
    },
  });

  if (!alert) {
    return null;
  }

  const explanation = await getAlertExplanation({
    alert: {
      alertType: alert.alertType,
      completenessLevel: alert.completenessLevel,
      confidenceLevel: alert.confidenceLevel,
      currencyCode: alert.currencyCode ?? shop.currencyCode ?? "USD",
      detectedForDate: alert.detectedForDate.toISOString(),
      entityKey: alert.entityKey,
      entityType: alert.entityType,
      id: alert.id,
      impactAmount: alert.impactAmount?.toString() ?? null,
      rulePayload: alert.rulePayload,
      severity: alert.severity,
      title: alert.title,
    },
    currencyCode: alert.currencyCode ?? shop.currencyCode ?? "USD",
    shopId: shop.id,
  });

  return {
    alert: {
      ...toAlertSummary(alert),
      explanation,
      expiresAt: alert.expiresAt?.toISOString() ?? null,
      firstDetectedAt: alert.firstDetectedAt.toISOString(),
      lastDetectedAt: alert.lastDetectedAt.toISOString(),
      rankScore: alert.rankScore?.toString() ?? null,
      rulePayload: alert.rulePayload,
      updatedAt: alert.updatedAt.toISOString(),
    },
    currencyCode: alert.currencyCode ?? shop.currencyCode ?? "USD",
    feedbacks: alert.feedbacks.map((feedback) => ({
      actorType: feedback.actorType,
      createdAt: feedback.createdAt.toISOString(),
      feedback: feedback.feedback,
      id: feedback.id,
      note: feedback.note,
    })),
    statusHistory: alert.statusHistory.map((history) => ({
      actorType: history.actorType,
      createdAt: history.createdAt.toISOString(),
      fromStatus: history.fromStatus,
      id: history.id,
      note: history.note,
      toStatus: history.toStatus,
    })),
    thread: alert.thread
      ? {
          entityKey: alert.thread.entityKey,
          entityType: alert.thread.entityType,
          id: alert.thread.id,
          isOpen: alert.thread.isOpen,
          lastDetectedAt: alert.thread.lastDetectedAt.toISOString(),
          ownerAssignedAt: alert.thread.ownerAssignedAt?.toISOString() ?? null,
          ownerName: alert.thread.ownerName,
          reviewedAt: alert.thread.reviewedAt?.toISOString() ?? null,
          reviewerName: alert.thread.reviewerName,
          workflowNote: alert.thread.workflowNote,
          alerts: alert.thread.alerts.map((threadAlert) => toAlertSummary(threadAlert)),
        }
      : null,
  };
}

export async function transitionAlertStatus(args: {
  shopDomain: string;
  alertId: string;
  nextStatus: AlertStatus;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  return db.$transaction(async (tx) => {
    const alert = await tx.alert.findFirst({
      where: {
        id: args.alertId,
        shopId: shop.id,
      },
      select: {
        id: true,
        status: true,
        threadId: true,
      },
    });

    if (!alert) {
      throw new Error("Alert not found.");
    }

    return applyAlertStatusTransition({
      tx,
      alerts: [alert],
      nextStatus: args.nextStatus,
      note: args.note,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  });
}

export async function transitionAlertThreadStatus(args: {
  shopDomain: string;
  threadId: string;
  nextStatus: AlertStatus;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  return db.$transaction(async (tx) => {
    const thread = await tx.alertThread.findFirst({
      where: {
        id: args.threadId,
        shopId: shop.id,
      },
      select: {
        id: true,
      },
    });

    if (!thread) {
      throw new Error("Alert thread not found.");
    }

    const eligibleStatuses = getEligibleStatusesForTransition(args.nextStatus);

    const alerts = await tx.alert.findMany({
      where: {
        threadId: thread.id,
        status: {
          in: eligibleStatuses,
        },
      },
      select: {
        id: true,
        status: true,
        threadId: true,
      },
    });

    return applyAlertStatusTransition({
      tx,
      alerts,
      nextStatus: args.nextStatus,
      note: args.note,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  });
}

export async function transitionAlertsStatus(args: {
  shopDomain: string;
  alertIds: string[];
  nextStatus: AlertStatus;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const alertIds = Array.from(new Set(args.alertIds.map((alertId) => alertId.trim()).filter(Boolean)));

  if (alertIds.length === 0) {
    throw new Error("Select one or more alerts first.");
  }

  return db.$transaction(async (tx) => {
    const alerts = await tx.alert.findMany({
      where: {
        id: {
          in: alertIds,
        },
        shopId: shop.id,
        status: {
          in: getEligibleStatusesForTransition(args.nextStatus),
        },
      },
      select: {
        id: true,
        status: true,
        threadId: true,
      },
    });

    if (alerts.length === 0) {
      throw new Error("No eligible alerts found for the requested action.");
    }

    return applyAlertStatusTransition({
      tx,
      alerts,
      nextStatus: args.nextStatus,
      note: args.note,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  });
}

export async function transitionAlertThreadsStatus(args: {
  shopDomain: string;
  threadIds: string[];
  nextStatus: AlertStatus;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const threadIds = Array.from(new Set(args.threadIds.map((threadId) => threadId.trim()).filter(Boolean)));

  if (threadIds.length === 0) {
    throw new Error("Select one or more threads first.");
  }

  return db.$transaction(async (tx) => {
    const eligibleThreadIds = await tx.alertThread.findMany({
      where: {
        id: {
          in: threadIds,
        },
        shopId: shop.id,
      },
      select: {
        id: true,
      },
    });

    if (eligibleThreadIds.length === 0) {
      throw new Error("No eligible alert threads found for the requested action.");
    }

    const alerts = await tx.alert.findMany({
      where: {
        threadId: {
          in: eligibleThreadIds.map((thread) => thread.id),
        },
        status: {
          in: getEligibleStatusesForTransition(args.nextStatus),
        },
      },
      select: {
        id: true,
        status: true,
        threadId: true,
      },
    });

    if (alerts.length === 0) {
      throw new Error("No eligible alerts found inside the selected threads.");
    }

    return applyAlertStatusTransition({
      tx,
      alerts,
      nextStatus: args.nextStatus,
      note: args.note,
      actorType: args.actorType,
      actorId: args.actorId,
    });
  });
}

export async function saveAlertSavedView(args: {
  shopDomain: string;
  name: string;
  filters: AlertFilters;
  visibility?: AlertSavedViewVisibility;
  description?: string | null;
  createdByLabel?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const normalizedName = args.name.trim();
  const visibility = args.visibility ?? "PRIVATE";
  const description = args.description?.trim() || null;
  const createdByLabel = args.createdByLabel?.trim() || "Merchant admin";

  if (!normalizedName) {
    throw new Error("Enter a name before saving this view.");
  }

  return db.alertSavedView.upsert({
    where: {
      shopId_visibility_name: {
        shopId: shop.id,
        visibility,
        name: normalizedName,
      },
    },
    create: {
      alertType: args.filters.alertType,
      createdByLabel,
      description,
      entityType: args.filters.entityType,
      name: normalizedName,
      queue: args.filters.queue,
      search: args.filters.search || null,
      severity: args.filters.severity,
      shopId: shop.id,
      visibility,
    },
    update: {
      alertType: args.filters.alertType,
      createdByLabel,
      description,
      entityType: args.filters.entityType,
      queue: args.filters.queue,
      search: args.filters.search || null,
      severity: args.filters.severity,
      visibility,
    },
  });
}

export async function deleteAlertSavedView(args: {
  shopDomain: string;
  savedViewId: string;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const savedView = await db.alertSavedView.findFirst({
    where: {
      id: args.savedViewId,
      shopId: shop.id,
    },
    select: {
      id: true,
    },
  });

  if (!savedView) {
    throw new Error("Saved alert view not found.");
  }

  await db.alertSavedView.delete({
    where: {
      id: savedView.id,
    },
  });

  return {
    deletedId: savedView.id,
  };
}

export async function updateAlertThreadsWorkflow(args: {
  shopDomain: string;
  threadIds: string[];
  ownerName?: string | null;
  reviewerName?: string | null;
  note?: string | null;
  markReviewed?: boolean;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const threadIds = Array.from(new Set(args.threadIds.map((threadId) => threadId.trim()).filter(Boolean)));

  if (threadIds.length === 0) {
    throw new Error("Select one or more threads first.");
  }

  const ownerName = args.ownerName?.trim() || null;
  const reviewerName = args.reviewerName?.trim() || null;
  const workflowNote = args.note?.trim() || null;

  if (!ownerName && !reviewerName && !workflowNote && !args.markReviewed) {
    throw new Error("Provide an owner, reviewer, workflow note, or review action first.");
  }

  const now = new Date();
  const result = await db.alertThread.updateMany({
    where: {
      id: {
        in: threadIds,
      },
      shopId: shop.id,
    },
    data: {
      ...(args.ownerName !== undefined
        ? {
            ownerAssignedAt: ownerName ? now : null,
            ownerName,
          }
        : {}),
      ...(args.reviewerName !== undefined
        ? {
            reviewerName,
          }
        : {}),
      ...(args.note !== undefined
        ? {
            workflowNote,
          }
        : {}),
      ...(args.markReviewed
        ? {
            reviewedAt: now,
          }
        : {}),
    },
  });

  if (result.count === 0) {
    throw new Error("No eligible threads found for the requested workflow update.");
  }

  return {
    updatedCount: result.count,
  };
}

export async function updateAlertThreadWorkflow(args: {
  shopDomain: string;
  threadId: string;
  ownerName?: string | null;
  reviewerName?: string | null;
  note?: string | null;
  markReviewed?: boolean;
}) {
  return updateAlertThreadsWorkflow({
    ...args,
    threadIds: [args.threadId],
  });
}

export async function createAlertFeedback(args: {
  shopDomain: string;
  alertId: string;
  feedback: FeedbackValue;
  note?: string | null;
  actorType?: string;
  actorId?: string | null;
}) {
  const shop = await getShopRecord(args.shopDomain);

  if (!shop) {
    throw new Error("Shop record not found.");
  }

  const alert = await db.alert.findFirst({
    where: {
      id: args.alertId,
      shopId: shop.id,
    },
    select: {
      id: true,
    },
  });

  if (!alert) {
    throw new Error("Alert not found.");
  }

  return db.alertFeedback.create({
    data: {
      alertId: alert.id,
      feedback: args.feedback,
      note: args.note?.trim() || null,
      actorType: args.actorType ?? "merchant_admin",
      actorId: args.actorId ?? null,
    },
  });
}
