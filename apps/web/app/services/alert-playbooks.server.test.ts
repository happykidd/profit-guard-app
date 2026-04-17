import assert from "node:assert/strict";
import test from "node:test";
import { buildAlertBrief } from "./alert-playbooks.server";

test("buildAlertBrief returns a structured playbook for low-margin alerts", () => {
  const brief = buildAlertBrief({
    alertType: "SHOP_LOW_MARGIN",
    entityKey: "shop",
    entityType: "SHOP",
    title: "Gross margin dropped to 4.5%",
    severity: "CRITICAL",
    completenessLevel: "LOW",
    confidenceLevel: "LOW",
    currencyCode: "USD",
    impactAmount: "27.00",
    rulePayload: {
      grossMarginRate: 0.045,
      threshold: 0.18,
      grossSalesAmount: 150,
      grossProfitBeforeAdSpend: 6.75,
    },
  });

  assert.match(brief.summary, /below the guardrail/i);
  assert.match(brief.primaryAction, /Audit discounting/i);
  assert.equal(brief.metrics[0]?.label, "Observed margin");
  assert.equal(brief.metrics[0]?.value, "4.5%");
});

test("buildAlertBrief highlights data-quality blocking for completeness alerts", () => {
  const brief = buildAlertBrief({
    alertType: "SHOP_LOW_COMPLETENESS",
    entityKey: "shop",
    entityType: "SHOP",
    title: "Data completeness dropped to LOW",
    severity: "HIGH",
    completenessLevel: "LOW",
    confidenceLevel: "LOW",
    impactAmount: "60",
    rulePayload: {
      variantCoverageRate: 0.42,
      orderCoverageRate: 0.58,
    },
  });

  assert.match(brief.summary, /coverage fell to LOW/i);
  assert.match(brief.primaryAction, /Backfill missing costs first/i);
  assert.equal(brief.metrics[0]?.value, "42.0%");
  assert.equal(brief.metrics[1]?.value, "58.0%");
});

test("buildAlertBrief falls back gracefully for unknown alert types", () => {
  const brief = buildAlertBrief({
    alertType: "UNKNOWN_ALERT",
    entityKey: "entity-1",
    entityType: "SHOP",
    title: "Unknown alert",
    severity: "MEDIUM",
  });

  assert.equal(brief.summary, "Unknown alert");
  assert.equal(brief.metrics[0]?.value, "SHOP / entity-1");
});

test("buildAlertBrief returns scoped playbooks for GMV up but profit flat alerts", () => {
  const brief = buildAlertBrief({
    alertType: "SHOP_GMV_UP_MARGIN_FLAT",
    entityKey: "shop",
    entityType: "SHOP",
    title: "GMV increased, but gross profit did not keep up",
    severity: "HIGH",
    currencyCode: "USD",
    impactAmount: "28.00",
    rulePayload: {
      currentGrossSalesAmount: 200,
      currentGrossProfitBeforeAdSpend: 9,
      currentGrossMarginRate: 0.045,
      previousGrossSalesAmount: 100,
      previousGrossProfitBeforeAdSpend: 24,
      marginDeltaRate: -0.195,
    },
  });

  assert.match(brief.summary, /Sales volume increased/i);
  assert.match(brief.primaryAction, /Break the day down/i);
  assert.equal(brief.metrics[0]?.label, "Current gross sales");
});
