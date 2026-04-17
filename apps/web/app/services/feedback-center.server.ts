import { AlertStatus, FeedbackValue, ReportType } from "@prisma/client";
import db from "../db.server";
import { getEmailDeliveryConfig } from "./email-delivery.server";
import { getAiReportGenerationConfig } from "./reports.server";

type ReviewReadinessInput = {
  consecutiveDailyReportDays: number;
  resolvedAlertCount: number;
  usefulFeedbackCount: number;
};

type LaunchCriteriaInput = {
  activeInstallCount: number;
  aiProviderReady: boolean;
  emailProviderReady: boolean;
  paidShopCount: number;
  proxyReviewNoteCount: number;
  proxyWeeklyActiveRate: number | null;
  refundSampleReady: boolean;
  shopsWithTwoWeekUsageCount: number;
  usefulFeedbackRate: number | null;
};

function normalizeDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function calculateConsecutiveDailyTouchDays(touchDates: Date[]) {
  const uniqueDates = [...new Set(touchDates.map((value) => normalizeDateKey(value)))].sort().reverse();

  if (uniqueDates.length === 0) {
    return 0;
  }

  let streak = 1;

  for (let index = 1; index < uniqueDates.length; index += 1) {
    const previous = new Date(`${uniqueDates[index - 1]}T00:00:00.000Z`);
    const current = new Date(`${uniqueDates[index]}T00:00:00.000Z`);
    const diffInDays = Math.round((previous.getTime() - current.getTime()) / (24 * 60 * 60 * 1000));

    if (diffInDays !== 1) {
      break;
    }

    streak += 1;
  }

  return streak;
}

export function assessReviewRequestReadiness(input: ReviewReadinessInput) {
  const triggers: string[] = [];

  if (input.usefulFeedbackCount >= 1) {
    triggers.push("Merchant marked at least one alert as useful.");
  }

  if (input.resolvedAlertCount >= 1) {
    triggers.push("Merchant resolved at least one alert.");
  }

  if (input.consecutiveDailyReportDays >= 3) {
    triggers.push("Merchant engaged with daily summaries for three consecutive days.");
  }

  return {
    blockedReasons:
      triggers.length > 0
        ? []
        : [
            "Wait for a value moment first: useful feedback, a resolved alert, or three consecutive daily-summary touch days.",
          ],
    nextMilestones: [
      "Capture the first USEFUL feedback on a high-signal alert.",
      "Capture the first RESOLVED alert after the merchant takes action.",
      "Keep the merchant coming back to the daily summary for at least three consecutive days.",
    ],
    ready: triggers.length > 0,
    recommendedCopy:
      triggers.length > 0
        ? "A soft App Store review request can be shown after the next successful workflow completion."
        : "Do not ask for a review yet. Wait until the merchant clearly experiences value.",
    triggers,
  };
}

export function assessLaunchCriteriaProgress(input: LaunchCriteriaInput) {
  const goals = [
    {
      current: input.activeInstallCount,
      label: "Active installs",
      met: input.activeInstallCount >= 10,
      target: "10",
    },
    {
      current: input.shopsWithTwoWeekUsageCount,
      label: "Shops with 14+ daily summaries",
      met: input.shopsWithTwoWeekUsageCount >= 5,
      target: "5",
    },
    {
      current: input.paidShopCount,
      label: "Paid shops (Starter / Growth)",
      met: input.paidShopCount >= 3,
      target: "3",
    },
    {
      current:
        input.proxyWeeklyActiveRate == null ? "Not enough telemetry" : `${(input.proxyWeeklyActiveRate * 100).toFixed(1)}%`,
      label: "Proxy weekly active rate",
      met: input.proxyWeeklyActiveRate != null && input.proxyWeeklyActiveRate >= 0.6,
      target: "60%",
    },
    {
      current:
        input.usefulFeedbackRate == null ? "No feedback yet" : `${(input.usefulFeedbackRate * 100).toFixed(1)}%`,
      label: "Useful alert feedback rate",
      met: input.usefulFeedbackRate != null && input.usefulFeedbackRate >= 0.4,
      target: "40%",
    },
    {
      current: input.proxyReviewNoteCount,
      label: "Qualitative review notes captured",
      met: input.proxyReviewNoteCount >= 5,
      target: "5",
    },
  ];

  const blockers = [
    !input.aiProviderReady ? "AI-assisted summaries are still disabled, so PRD-level AI validation is blocked." : null,
    !input.emailProviderReady ? "External email delivery is not configured yet, so digest sending is still app-internal only." : null,
    !input.refundSampleReady ? "Current real-store validation is still missing refund samples, so refund-related rules remain only partially validated." : null,
  ].filter((value): value is string => Boolean(value));

  return {
    blockers,
    goals,
    metCount: goals.filter((goal) => goal.met).length,
    totalCount: goals.length,
  };
}

async function getShopRecord(shopDomain: string) {
  return db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      currentPlan: true,
      id: true,
      shopDomain: true,
      shopName: true,
      subscriptionStatus: true,
    },
  });
}

export async function getFeedbackCenterOverview(shopDomain: string) {
  const shop = await getShopRecord(shopDomain);

  if (!shop) {
    return null;
  }

  const [
    usefulFeedbackCount,
    notUsefulFeedbackCount,
    resolvedAlertCount,
    activeAlertCount,
    closedAlertCount,
    recentFeedbacks,
    recentResolvedAlerts,
    recentDailyReports,
    activeInstallCount,
    paidShopCount,
    dailyReportCountsByShop,
    weeklyActiveGroups,
    proxyReviewNotes,
    refundSampleCount,
  ] = await Promise.all([
    db.alertFeedback.count({
      where: {
        alert: {
          shopId: shop.id,
        },
        feedback: FeedbackValue.USEFUL,
      },
    }),
    db.alertFeedback.count({
      where: {
        alert: {
          shopId: shop.id,
        },
        feedback: FeedbackValue.NOT_USEFUL,
      },
    }),
    db.alertStatusHistory.count({
      where: {
        alert: {
          shopId: shop.id,
        },
        toStatus: AlertStatus.RESOLVED,
      },
    }),
    db.alert.count({
      where: {
        shopId: shop.id,
        status: {
          in: [AlertStatus.NEW, AlertStatus.READ],
        },
      },
    }),
    db.alert.count({
      where: {
        shopId: shop.id,
        status: {
          in: [AlertStatus.RESOLVED, AlertStatus.IGNORED],
        },
      },
    }),
    db.alertFeedback.findMany({
      where: {
        alert: {
          shopId: shop.id,
        },
      },
      include: {
        alert: {
          select: {
            alertType: true,
            entityKey: true,
            status: true,
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    }),
    db.alert.findMany({
      where: {
        shopId: shop.id,
        status: AlertStatus.RESOLVED,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        alertType: true,
        detectedForDate: true,
        entityKey: true,
        title: true,
        updatedAt: true,
      },
      take: 10,
    }),
    db.reportSnapshot.findMany({
      where: {
        shopId: shop.id,
        reportType: ReportType.DAILY,
      },
      orderBy: {
        periodEnd: "desc",
      },
      select: {
        createdAt: true,
        id: true,
        periodEnd: true,
        periodStart: true,
        reportType: true,
      },
      take: 14,
    }),
    db.shop.count({
      where: {
        isActive: true,
      },
    }),
    db.shop.count({
      where: {
        currentPlan: {
          in: ["STARTER", "GROWTH"],
        },
        subscriptionStatus: {
          in: ["ACTIVE", "TRIALING"],
        },
      },
    }),
    db.reportSnapshot.groupBy({
      by: ["shopId"],
      _count: {
        _all: true,
      },
      where: {
        reportType: ReportType.DAILY,
      },
    }),
    db.reportSnapshot.groupBy({
      by: ["shopId"],
      _count: {
        _all: true,
      },
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    db.alertFeedback.findMany({
      where: {
        note: {
          not: null,
        },
      },
      select: {
        note: true,
      },
    }),
    db.refund.count({
      where: {
        shopId: shop.id,
      },
    }),
  ]);

  const consecutiveDailyReportDays = calculateConsecutiveDailyTouchDays(
    recentDailyReports.map((report) => report.periodEnd),
  );
  const reviewReadiness = assessReviewRequestReadiness({
    consecutiveDailyReportDays,
    resolvedAlertCount,
    usefulFeedbackCount,
  });
  const totalFeedbackCount = usefulFeedbackCount + notUsefulFeedbackCount;
  const shopsWithTwoWeekUsageCount = dailyReportCountsByShop.filter((entry) => entry._count._all >= 14).length;
  const proxyWeeklyActiveRate =
    activeInstallCount > 0 ? weeklyActiveGroups.length / activeInstallCount : null;
  const proxyReviewNoteCount = proxyReviewNotes.filter((entry) => entry.note?.trim().length).length;
  const launchReadiness = assessLaunchCriteriaProgress({
    activeInstallCount,
    aiProviderReady: getAiReportGenerationConfig().ready,
    emailProviderReady: getEmailDeliveryConfig().ready,
    paidShopCount,
    proxyReviewNoteCount,
    proxyWeeklyActiveRate,
    refundSampleReady: refundSampleCount > 0,
    shopsWithTwoWeekUsageCount,
    usefulFeedbackRate: totalFeedbackCount > 0 ? usefulFeedbackCount / totalFeedbackCount : null,
  });

  return {
    counts: {
      activeAlertCount,
      closedAlertCount,
      notUsefulFeedbackCount,
      resolvedAlertCount,
      usefulFeedbackCount,
    },
    recentDailyReports: recentDailyReports.map((report) => ({
      createdAt: report.createdAt.toISOString(),
      id: report.id,
      periodEnd: report.periodEnd.toISOString(),
      periodStart: report.periodStart.toISOString(),
      reportType: report.reportType,
    })),
    recentFeedbacks: recentFeedbacks.map((feedback) => ({
      alert: {
        alertType: feedback.alert.alertType,
        entityKey: feedback.alert.entityKey,
        status: feedback.alert.status,
        title: feedback.alert.title,
      },
      createdAt: feedback.createdAt.toISOString(),
      feedback: feedback.feedback,
      id: feedback.id,
      note: feedback.note,
    })),
    recentResolvedAlerts: recentResolvedAlerts.map((alert) => ({
      alertType: alert.alertType,
      detectedForDate: alert.detectedForDate.toISOString(),
      entityKey: alert.entityKey,
      title: alert.title,
      updatedAt: alert.updatedAt.toISOString(),
    })),
    reviewReadiness: {
      ...reviewReadiness,
      consecutiveDailyReportDays,
    },
    launchReadiness,
    shop: {
      currentPlan: shop.currentPlan,
      shopDomain: shop.shopDomain,
      shopName: shop.shopName ?? shop.shopDomain,
      subscriptionStatus: shop.subscriptionStatus,
    },
  };
}
