import prisma from "../../../../packages/db/src/client";
import {
  createAlertFeedback,
  deleteAlertSavedView,
  getAlertDetail,
  getAlertsOverview,
  saveAlertSavedView,
  transitionAlertsStatus,
  transitionAlertStatus,
  transitionAlertThreadsStatus,
  transitionAlertThreadStatus,
  updateAlertThreadsWorkflow,
} from "../services/alerts.server";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DEFAULT_FILTERS = {
  alertType: "ALL",
  entityType: "ALL",
  queue: "ALL",
  search: "",
  severity: "ALL",
} as const;

async function main() {
  const shopDomain = `alert-lifecycle-${Date.now()}.myshopify.com`;
  let createdShopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName: "Profit Guard Alert Lifecycle Smoke Shop",
        currencyCode: "USD",
        ianaTimezone: "UTC",
        backfillStatus: "COMPLETED",
      },
    });
    createdShopId = shop.id;

    const thread = await prisma.alertThread.create({
      data: {
        shopId: shop.id,
        alertType: "SHOP_LOW_MARGIN",
        entityType: "SHOP",
        entityKey: "shop",
        isOpen: true,
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    const refundThread = await prisma.alertThread.create({
      data: {
        shopId: shop.id,
        alertType: "SHOP_HIGH_REFUND_RATE",
        entityType: "SHOP",
        entityKey: "shop",
        isOpen: true,
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
      },
    });

    const alert = await prisma.alert.create({
      data: {
        shopId: shop.id,
        threadId: thread.id,
        alertType: "SHOP_LOW_MARGIN",
        severity: "CRITICAL",
        status: "NEW",
        entityType: "SHOP",
        entityKey: "shop",
        title: "Gross margin dropped to 4.5%",
        impactAmount: "27.00",
        currencyCode: "USD",
        confidenceLevel: "LOW",
        completenessLevel: "LOW",
        detectedForDate: new Date("2026-04-15T00:00:00.000Z"),
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        rankScore: "97.7000",
        rulePayload: {
          grossMarginRate: 0.045,
          threshold: 0.18,
        },
      },
    });

    const siblingAlert = await prisma.alert.create({
      data: {
        shopId: shop.id,
        threadId: thread.id,
        alertType: "SHOP_LOW_MARGIN",
        severity: "HIGH",
        status: "NEW",
        entityType: "SHOP",
        entityKey: "shop",
        title: "Gross margin stayed under threshold",
        impactAmount: "19.00",
        currencyCode: "USD",
        confidenceLevel: "LOW",
        completenessLevel: "LOW",
        detectedForDate: new Date("2026-04-16T00:00:00.000Z"),
        firstDetectedAt: new Date("2026-04-16T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-16T00:00:00.000Z"),
        rankScore: "88.5000",
        rulePayload: {
          grossMarginRate: 0.08,
          threshold: 0.18,
        },
      },
    });

    const refundAlert = await prisma.alert.create({
      data: {
        shopId: shop.id,
        threadId: refundThread.id,
        alertType: "SHOP_HIGH_REFUND_RATE",
        severity: "HIGH",
        status: "NEW",
        entityType: "SHOP",
        entityKey: "shop",
        title: "Refund rate reached 15.0%",
        impactAmount: "30.00",
        currencyCode: "USD",
        confidenceLevel: "MEDIUM",
        completenessLevel: "HIGH",
        detectedForDate: new Date("2026-04-15T00:00:00.000Z"),
        firstDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        lastDetectedAt: new Date("2026-04-15T00:00:00.000Z"),
        rankScore: "77.0000",
        rulePayload: {
          refundRate: 0.15,
          threshold: 0.08,
        },
      },
    });

    await prisma.alertStatusHistory.create({
      data: {
        alertId: alert.id,
        fromStatus: null,
        toStatus: "NEW",
        note: "Seeded by smoke test",
        actorType: "system",
        actorId: "smoke",
      },
    });

    await transitionAlertStatus({
      shopDomain,
      alertId: alert.id,
      nextStatus: "READ",
      note: "Merchant reviewed it",
    });

    await createAlertFeedback({
      shopDomain,
      alertId: alert.id,
      feedback: "USEFUL",
      note: "Good catch",
    });

    const savedView = await saveAlertSavedView({
      shopDomain,
      name: "Low margin active queue",
      createdByLabel: "David",
      description: "Open this during repricing reviews.",
      filters: {
        ...DEFAULT_FILTERS,
        alertType: "SHOP_LOW_MARGIN",
        queue: "ACTIVE",
      },
      visibility: "SHARED",
    });

    const privateSavedView = await saveAlertSavedView({
      shopDomain,
      name: "Refund watchlist",
      createdByLabel: "Ops Lead",
      description: "Private QA queue for refund anomalies.",
      filters: {
        ...DEFAULT_FILTERS,
        alertType: "SHOP_HIGH_REFUND_RATE",
        queue: "ACTIVE",
        severity: "HIGH",
      },
      visibility: "PRIVATE",
    });

    await updateAlertThreadsWorkflow({
      shopDomain,
      threadIds: [thread.id],
      ownerName: "David",
      note: "Finance owns margin investigation",
    });
    await updateAlertThreadsWorkflow({
      shopDomain,
      threadIds: [thread.id],
      reviewerName: "Ops Lead",
    });
    await updateAlertThreadsWorkflow({
      shopDomain,
      threadIds: [thread.id],
      reviewerName: "Ops Lead",
      note: "Reviewed after repricing plan",
      markReviewed: true,
    });

    const filteredActiveOverview = await getAlertsOverview({
      shopDomain,
      filters: {
        ...DEFAULT_FILTERS,
        alertType: "SHOP_LOW_MARGIN",
        queue: "ACTIVE",
      },
    });
    assertCondition(filteredActiveOverview, "Filtered overview was not returned");
    assertCondition(filteredActiveOverview.activeAlerts.length === 2, "Expected filtered low-margin active alerts");
    assertCondition(filteredActiveOverview.recentClosedAlerts.length === 0, "Closed queue should be hidden");
    assertCondition(
      filteredActiveOverview.availableAlertTypes.includes("SHOP_HIGH_REFUND_RATE"),
      "Filter options should expose every alert type",
    );
    assertCondition(filteredActiveOverview.savedViews.length === 2, "Expected both saved views in the overview");
    assertCondition(
      filteredActiveOverview.savedViews[0]?.href === "/app/alerts?queue=ACTIVE&alertType=SHOP_LOW_MARGIN",
      "Shared saved view href should preserve scoped filters",
    );
    assertCondition(
      filteredActiveOverview.savedViews[0]?.visibility === "SHARED",
      "Shared saved view should sort ahead of private views",
    );
    assertCondition(
      filteredActiveOverview.savedViews[1]?.href ===
        "/app/alerts?queue=ACTIVE&severity=HIGH&alertType=SHOP_HIGH_REFUND_RATE",
      "Private saved view href should preserve scoped filters",
    );
    assertCondition(
      filteredActiveOverview.savedViews[1]?.visibility === "PRIVATE",
      "Second saved view should be private",
    );
    assertCondition(
      filteredActiveOverview.savedViews[0]?.createdByLabel === "David",
      "Saved view should keep creator label",
    );
    assertCondition(
      filteredActiveOverview.savedViews[0]?.description === "Open this during repricing reviews.",
      "Saved view should keep description",
    );

    const bulkAlertResolveResult = await transitionAlertsStatus({
      shopDomain,
      alertIds: [alert.id, siblingAlert.id],
      nextStatus: "RESOLVED",
      note: "Issue fixed in bulk",
    });
    assertCondition(bulkAlertResolveResult.updatedCount === 2, "Expected selected alerts to resolve in bulk");

    const closedOverview = await getAlertsOverview({
      shopDomain,
      filters: DEFAULT_FILTERS,
    });
    assertCondition(closedOverview, "Closed overview was not returned");
    assertCondition(closedOverview.activeAlerts.length === 1, "Refund alert should remain in the active queue");
    assertCondition(closedOverview.recentClosedAlerts.length === 2, "Resolved alerts should be in the closed queue");

    const bulkThreadIgnoreResult = await transitionAlertThreadsStatus({
      shopDomain,
      threadIds: [refundThread.id],
      nextStatus: "IGNORED",
      note: "Known refund campaign",
    });
    assertCondition(bulkThreadIgnoreResult.updatedCount === 1, "Expected selected thread alerts to ignore in bulk");

    const fullyClosedOverview = await getAlertsOverview({
      shopDomain,
      filters: DEFAULT_FILTERS,
    });
    assertCondition(fullyClosedOverview, "Fully closed overview was not returned");
    assertCondition(fullyClosedOverview.activeAlerts.length === 0, "Every alert should now be out of the active queue");
    assertCondition(fullyClosedOverview.recentClosedAlerts.length === 3, "Expected three closed alerts after bulk thread ignore");

    const alertReopenResult = await transitionAlertsStatus({
      shopDomain,
      alertIds: [alert.id, siblingAlert.id],
      nextStatus: "NEW",
      note: "Regression detected in bulk",
    });
    assertCondition(alertReopenResult.updatedCount === 2, "Expected selected alerts to reopen in bulk");

    const refundThreadReopenResult = await transitionAlertThreadStatus({
      shopDomain,
      threadId: refundThread.id,
      nextStatus: "NEW",
      note: "Refund issue returned",
    });
    assertCondition(refundThreadReopenResult.updatedCount === 1, "Expected refund thread to reopen");

    const [overview, detail, refreshedThread, refreshedRefundThread] = await Promise.all([
      getAlertsOverview({
        shopDomain,
        filters: {
          ...DEFAULT_FILTERS,
          alertType: "SHOP_LOW_MARGIN",
          queue: "ACTIVE",
        },
      }),
      getAlertDetail({
        shopDomain,
        alertId: alert.id,
      }),
      prisma.alertThread.findUnique({
        where: {
          id: thread.id,
        },
        select: {
          isOpen: true,
        },
      }),
      prisma.alertThread.findUnique({
        where: {
          id: refundThread.id,
        },
        select: {
          isOpen: true,
        },
      }),
    ]);

    assertCondition(overview, "Overview was not returned");
    assertCondition(detail, "Alert detail was not returned");
    assertCondition(overview.activeAlerts.length === 2, "Filtered reopened alerts should be back in the active queue");
    assertCondition(overview.activeThreads.length === 1, "Only low-margin thread should match filtered active queue");
    assertCondition(overview.recentClosedAlerts.length === 0, "Closed queue should stay hidden by filter");
    assertCondition(detail.alert.status === "NEW", "Alert should have reopened to NEW");
    assertCondition(
      detail.alert.brief.primaryAction.includes("Audit discounting"),
      "Alert detail should expose a structured playbook",
    );
    assertCondition(
      overview.activeAlerts[0]?.brief.summary.includes("guardrail"),
      "Alert overview should expose structured summaries",
    );
    assertCondition(detail.statusHistory.length === 4, "Expected seeded NEW plus bulk transitions");
    assertCondition(detail.feedbacks.length === 1, "Expected one feedback row");
    assertCondition(refreshedThread?.isOpen === true, "Alert thread should reopen when alert reopens");
    assertCondition(refreshedRefundThread?.isOpen === true, "Refund thread should reopen through thread action");
    assertCondition(detail.thread?.ownerName === "David", "Thread owner should be assigned");
    assertCondition(detail.thread?.reviewerName === "Ops Lead", "Thread reviewer should be assigned");
    assertCondition(detail.thread?.workflowNote === "Reviewed after repricing plan", "Workflow note should be updated");
    assertCondition(Boolean(detail.thread?.reviewedAt), "Thread should have a reviewed timestamp");
    assertCondition(
      detail.thread?.alerts.some((threadAlert) => threadAlert.id === siblingAlert.id && threadAlert.status === "NEW"),
      "Sibling alert should have reopened through thread action",
    );
    assertCondition(
      !detail.thread?.alerts.some((threadAlert) => threadAlert.id === refundAlert.id),
      "Filtered thread detail should stay scoped to the low-margin thread",
    );

    await deleteAlertSavedView({
      shopDomain,
      savedViewId: savedView.id,
    });
    await deleteAlertSavedView({
      shopDomain,
      savedViewId: privateSavedView.id,
    });

    const finalOverview = await getAlertsOverview({
      shopDomain,
      filters: DEFAULT_FILTERS,
    });
    assertCondition(finalOverview, "Final overview was not returned");
    assertCondition(finalOverview.savedViews.length === 0, "Saved view should be deleted cleanly");

    console.info(
      JSON.stringify(
        {
          filteredOverview: {
            activeAlerts: overview.activeAlerts.length,
            activeThreads: overview.activeThreads.length,
            queue: overview.filters.queue,
            alertType: overview.filters.alertType,
            savedViews: filteredActiveOverview.savedViews.map((savedViewEntry) => ({
              name: savedViewEntry.name,
              visibility: savedViewEntry.visibility,
              createdByLabel: savedViewEntry.createdByLabel,
            })),
          },
          activeAlerts: overview.activeAlerts.map((activeAlert) => ({
            id: activeAlert.id,
            status: activeAlert.status,
            title: activeAlert.title,
          })),
          bulkResults: {
            resolvedAlerts: bulkAlertResolveResult.updatedCount,
            ignoredThreadAlerts: bulkThreadIgnoreResult.updatedCount,
            reopenedAlerts: alertReopenResult.updatedCount,
            reopenedRefundThreadAlerts: refundThreadReopenResult.updatedCount,
          },
          feedbacks: detail.feedbacks.map((feedback) => ({
            feedback: feedback.feedback,
            note: feedback.note,
          })),
          statusHistory: detail.statusHistory.map((history) => ({
            fromStatus: history.fromStatus,
            toStatus: history.toStatus,
            note: history.note,
          })),
          thread: detail.thread
            ? {
                id: detail.thread.id,
                isOpen: detail.thread.isOpen,
                alerts: detail.thread.alerts.length,
                ownerName: detail.thread.ownerName,
                reviewerName: detail.thread.reviewerName,
                reviewedAt: detail.thread.reviewedAt,
              }
            : null,
          playbook: {
            summary: detail.alert.brief.summary,
            primaryAction: detail.alert.brief.primaryAction,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdShopId) {
      await prisma.shop.delete({
        where: {
          id: createdShopId,
        },
      });
    }

    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Alert lifecycle failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
