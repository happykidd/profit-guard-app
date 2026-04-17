import assert from "node:assert/strict";
import test from "node:test";
import { AlertStatus, FeedbackValue } from "@prisma/client";
import {
  buildAlertFiltersHref,
  resolveAlertFilters,
  resolveAlertFeedbackIntent,
  resolveAlertSavedViewVisibility,
  resolveAlertStatusIntent,
  resolveAlertWorkflowIntent,
} from "./alerts.server";

test("resolveAlertStatusIntent maps supported intents to alert statuses", () => {
  assert.equal(resolveAlertStatusIntent("mark_read"), AlertStatus.READ);
  assert.equal(resolveAlertStatusIntent("resolve"), AlertStatus.RESOLVED);
  assert.equal(resolveAlertStatusIntent("ignore"), AlertStatus.IGNORED);
  assert.equal(resolveAlertStatusIntent("reopen"), AlertStatus.NEW);
  assert.equal(resolveAlertStatusIntent("unknown"), null);
});

test("resolveAlertFeedbackIntent maps supported intents to feedback values", () => {
  assert.equal(resolveAlertFeedbackIntent("feedback_useful"), FeedbackValue.USEFUL);
  assert.equal(resolveAlertFeedbackIntent("feedback_not_useful"), FeedbackValue.NOT_USEFUL);
  assert.equal(resolveAlertFeedbackIntent("unknown"), null);
});

test("resolveAlertWorkflowIntent maps supported intents to workflow actions", () => {
  assert.equal(resolveAlertWorkflowIntent("assign_owner"), "assign_owner");
  assert.equal(resolveAlertWorkflowIntent("assign_reviewer"), "assign_reviewer");
  assert.equal(resolveAlertWorkflowIntent("mark_reviewed"), "mark_reviewed");
  assert.equal(resolveAlertWorkflowIntent("unknown"), null);
});

test("resolveAlertSavedViewVisibility normalizes supported visibilities", () => {
  assert.equal(resolveAlertSavedViewVisibility("shared"), "SHARED");
  assert.equal(resolveAlertSavedViewVisibility("PRIVATE"), "PRIVATE");
  assert.equal(resolveAlertSavedViewVisibility("team"), "PRIVATE");
});

test("resolveAlertFilters normalizes supported query parameters", () => {
  const filters = resolveAlertFilters(
    new URLSearchParams({
      alertType: "SHOP_LOW_MARGIN",
      entityType: "sku",
      queue: "closed",
      search: " margin ",
      severity: "critical",
    }),
  );

  assert.deepEqual(filters, {
    alertType: "SHOP_LOW_MARGIN",
    entityType: "SKU",
    queue: "CLOSED",
    search: "margin",
    severity: "CRITICAL",
  });
});

test("resolveAlertFilters falls back to ALL for unsupported queue and blank alert type", () => {
  const filters = resolveAlertFilters(
    new URLSearchParams({
      alertType: "   ",
      queue: "later",
    }),
  );

  assert.deepEqual(filters, {
    alertType: "ALL",
    entityType: "ALL",
    queue: "ALL",
    search: "",
    severity: "ALL",
  });
});

test("buildAlertFiltersHref omits default filters and preserves scoped filters", () => {
  assert.equal(
    buildAlertFiltersHref({
      alertType: "SHOP_LOW_MARGIN",
      entityType: "SKU",
      queue: "ACTIVE",
      search: "tee",
      severity: "HIGH",
    }),
    "/app/alerts?queue=ACTIVE&severity=HIGH&alertType=SHOP_LOW_MARGIN&entityType=SKU&search=tee",
  );

  assert.equal(
    buildAlertFiltersHref({
      alertType: "ALL",
      entityType: "ALL",
      queue: "ALL",
      search: "",
      severity: "ALL",
    }),
    "/app/alerts",
  );
});
