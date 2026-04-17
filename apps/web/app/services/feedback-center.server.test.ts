import assert from "node:assert/strict";
import test from "node:test";
import {
  assessLaunchCriteriaProgress,
  assessReviewRequestReadiness,
  calculateConsecutiveDailyTouchDays,
} from "./feedback-center.server";

test("calculateConsecutiveDailyTouchDays counts consecutive daily report windows", () => {
  const streak = calculateConsecutiveDailyTouchDays([
    new Date("2026-04-15T00:00:00.000Z"),
    new Date("2026-04-14T12:00:00.000Z"),
    new Date("2026-04-13T23:59:59.000Z"),
    new Date("2026-04-10T00:00:00.000Z"),
  ]);

  assert.equal(streak, 3);
});

test("assessReviewRequestReadiness becomes ready when a value moment exists", () => {
  const ready = assessReviewRequestReadiness({
    consecutiveDailyReportDays: 1,
    resolvedAlertCount: 0,
    usefulFeedbackCount: 1,
  });
  const blocked = assessReviewRequestReadiness({
    consecutiveDailyReportDays: 1,
    resolvedAlertCount: 0,
    usefulFeedbackCount: 0,
  });

  assert.equal(ready.ready, true);
  assert.match(ready.recommendedCopy, /soft App Store review request/i);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockedReasons.length, 1);
});

test("assessLaunchCriteriaProgress highlights unmet launch blockers", () => {
  const progress = assessLaunchCriteriaProgress({
    activeInstallCount: 2,
    aiProviderReady: false,
    emailProviderReady: false,
    paidShopCount: 1,
    proxyReviewNoteCount: 0,
    proxyWeeklyActiveRate: 0.25,
    refundSampleReady: false,
    shopsWithTwoWeekUsageCount: 0,
    usefulFeedbackRate: 0.2,
  });

  assert.equal(progress.metCount, 0);
  assert.equal(progress.totalCount, 6);
  assert.match(progress.blockers.join(" "), /AI-assisted summaries are still disabled/i);
  assert.match(progress.blockers.join(" "), /refund samples/i);
});
