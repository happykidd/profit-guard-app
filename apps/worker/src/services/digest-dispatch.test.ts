import assert from "node:assert/strict";
import test from "node:test";
import { resolveDueDigestTypes } from "./digest-dispatch";

test("resolveDueDigestTypes returns daily digest when local hour matches preference", () => {
  const dueTypes = resolveDueDigestTypes({
    dailySummaryEnabled: true,
    now: new Date("2026-04-14T08:00:00.000Z"),
    preferredSendHour: 8,
    timeZone: "UTC",
    weeklySummaryEnabled: false,
  });

  assert.deepEqual(dueTypes, ["DAILY"]);
});

test("resolveDueDigestTypes returns weekly digest only on Monday", () => {
  const mondayDueTypes = resolveDueDigestTypes({
    dailySummaryEnabled: false,
    now: new Date("2026-04-13T08:00:00.000Z"),
    preferredSendHour: 8,
    timeZone: "UTC",
    weeklySummaryEnabled: true,
  });
  const tuesdayDueTypes = resolveDueDigestTypes({
    dailySummaryEnabled: false,
    now: new Date("2026-04-14T08:00:00.000Z"),
    preferredSendHour: 8,
    timeZone: "UTC",
    weeklySummaryEnabled: true,
  });

  assert.deepEqual(mondayDueTypes, ["WEEKLY"]);
  assert.deepEqual(tuesdayDueTypes, []);
});
