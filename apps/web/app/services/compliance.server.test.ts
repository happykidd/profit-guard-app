import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShopifyOrderIdCandidates,
  normalizeComplianceOrderIdentifiers,
} from "./compliance.server";

test("normalizeComplianceOrderIdentifiers deduplicates string and numeric ids", () => {
  const identifiers = normalizeComplianceOrderIdentifiers([
    12345,
    "12345",
    "gid://shopify/Order/98765",
    null,
    "",
  ]);

  assert.deepEqual(identifiers, ["12345", "gid://shopify/Order/98765"]);
});

test("buildShopifyOrderIdCandidates creates numeric and gid variants", () => {
  const numericCandidates = buildShopifyOrderIdCandidates("12345");
  assert.deepEqual(numericCandidates, [
    "12345",
    "gid://shopify/Order/12345",
  ]);

  const gidCandidates = buildShopifyOrderIdCandidates("gid://shopify/Order/67890");
  assert.deepEqual(gidCandidates, [
    "gid://shopify/Order/67890",
    "67890",
  ]);
});
