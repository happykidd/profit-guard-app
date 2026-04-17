import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackAlertExplanation, parseAiExplanationCandidate } from "./alert-ai.server";
import { buildAlertBrief } from "./alert-playbooks.server";

const alertInput = {
  alertType: "SHOP_LOW_MARGIN",
  completenessLevel: "HIGH",
  confidenceLevel: "HIGH",
  currencyCode: "USD",
  detectedForDate: "2026-04-15T00:00:00.000Z",
  entityKey: "shop",
  entityType: "SHOP",
  id: "alert_1",
  impactAmount: "27.00",
  rulePayload: {
    grossMarginRate: 0.045,
    grossProfitBeforeAdSpend: 6.75,
    grossSalesAmount: 150,
    threshold: 0.18,
  },
  severity: "CRITICAL",
  title: "Gross margin dropped to 4.5%",
} as const;

test("buildFallbackAlertExplanation mirrors rules-first playbook guidance", () => {
  const brief = buildAlertBrief({
    alertType: alertInput.alertType,
    completenessLevel: alertInput.completenessLevel,
    confidenceLevel: alertInput.confidenceLevel,
    currencyCode: alertInput.currencyCode,
    entityKey: alertInput.entityKey,
    entityType: alertInput.entityType,
    impactAmount: alertInput.impactAmount,
    rulePayload: alertInput.rulePayload,
    severity: alertInput.severity,
    title: alertInput.title,
  });
  const explanation = buildFallbackAlertExplanation(alertInput, brief);

  assert.equal(explanation.generator.mode, "rules-first-fallback");
  assert.equal(explanation.generator.fallbackUsed, true);
  assert.equal(explanation.narrative.summary, brief.summary);
  assert.equal(explanation.narrative.whyItMatters, brief.whyItMatters);
  assert.equal(explanation.narrative.recommendedActions[0], brief.primaryAction);
});

test("parseAiExplanationCandidate accepts structured AI explanations that reuse existing numbers", () => {
  const brief = buildAlertBrief({
    alertType: alertInput.alertType,
    completenessLevel: alertInput.completenessLevel,
    confidenceLevel: alertInput.confidenceLevel,
    currencyCode: alertInput.currencyCode,
    entityKey: alertInput.entityKey,
    entityType: alertInput.entityType,
    impactAmount: alertInput.impactAmount,
    rulePayload: alertInput.rulePayload,
    severity: alertInput.severity,
    title: alertInput.title,
  });

  const candidate = parseAiExplanationCandidate(
    JSON.stringify({
      nextQuestion: "Which discount or shipping change caused the 4.5% margin outcome?",
      recommendedActions: [
        "Audit discounting and shipping leakage before scaling volume.",
        "Reconfirm the direct cost source on the top low-margin SKUs.",
      ],
      summary: "Store margin is running at 4.5%, below the guardrail of 18.0%.",
      whyItMatters:
        "At 4.5% margin, a small refund or shipping issue can erase the day's contribution quickly.",
    }),
    alertInput,
    brief,
  );

  assert.match(candidate.summary, /4.5%/);
  assert.equal(candidate.recommendedActions.length, 2);
  assert.match(candidate.nextQuestion, /4.5% margin outcome/);
});
