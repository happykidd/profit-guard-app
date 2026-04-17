import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeCategoryProfileKey,
  findCategoryProfileMatch,
  formatDefaultCostRatePercent,
  normalizeCategoryKey,
  parseDefaultCostRateInput,
  parseCategoryProfileKey,
} from "../../../../packages/db/src/category-cost";

test("normalizeCategoryKey trims and collapses whitespace", () => {
  assert.equal(normalizeCategoryKey("  Home   Decor  "), "Home Decor");
});

test("parseDefaultCostRateInput accepts percentage and decimal style input", () => {
  assert.deepEqual(parseDefaultCostRateInput("42"), {
    error: null,
    normalizedRate: "0.4200",
  });
  assert.deepEqual(parseDefaultCostRateInput("0.42"), {
    error: null,
    normalizedRate: "0.4200",
  });
});

test("parseDefaultCostRateInput rejects out-of-range values and formatter renders percent", () => {
  assert.deepEqual(parseDefaultCostRateInput("180"), {
    error: "Default cost rate must be between 0 and 100%.",
    normalizedRate: null,
  });
  assert.equal(formatDefaultCostRatePercent("0.3750"), "37.5%");
});

test("parseCategoryProfileKey handles legacy product type keys and scoped fallback keys", () => {
  assert.deepEqual(parseCategoryProfileKey("Apparel"), {
    displayLabel: "Product type",
    key: "Apparel",
    normalizedMatchKey: "product_type::apparel",
    scope: "PRODUCT_TYPE",
  });

  assert.deepEqual(parseCategoryProfileKey("vendor::Acme Supply"), {
    displayLabel: "Vendor",
    key: "Acme Supply",
    normalizedMatchKey: "vendor::acme supply",
    scope: "VENDOR",
  });
});

test("findCategoryProfileMatch respects product type, vendor, then tag priority", () => {
  const profiles = [
    {
      categoryKey: encodeCategoryProfileKey("TAG", "Summer"),
    },
    {
      categoryKey: encodeCategoryProfileKey("VENDOR", "Acme Supply"),
    },
  ];

  const vendorMatch = findCategoryProfileMatch(profiles, {
    productType: null,
    tags: ["Summer"],
    vendor: "Acme Supply",
  });

  assert.equal(vendorMatch?.scope, "VENDOR");
  assert.equal(vendorMatch?.matchedKey, "Acme Supply");
});
