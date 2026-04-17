import assert from "node:assert/strict";
import test from "node:test";
import { resolveLineItemCost } from "./cost-resolution";

test("resolveLineItemCost prefers direct variant cost before category defaults", () => {
  const resolved = resolveLineItemCost({
    candidates: [
      {
        variantId: "variant-1",
        sku: "PG-TEE-001",
        costAmount: "12.5000",
      },
    ],
    supplierContracts: [
      {
        vendorName: "Profit Guard",
        productType: "Apparel",
        unitCostAmount: "9.0000",
      },
    ],
    categoryProfiles: [
      {
        categoryKey: "Apparel",
        defaultCostRate: "0.4500",
      },
    ],
    localVariantId: "variant-1",
    sku: "PG-TEE-001",
    productType: "Apparel",
    vendor: "Profit Guard",
    tags: ["Featured"],
    quantity: 2,
    lineSubtotalAmount: 60,
    lineDiscountAmount: 5,
  });

  assert.deepEqual(resolved, {
    amount: 25,
    source: "VARIANT",
  });
});

test("resolveLineItemCost falls back to category default using net sales", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [],
    categoryProfiles: [
      {
        categoryKey: "product_type::Apparel",
        defaultCostRate: "0.4000",
      },
    ],
    localVariantId: null,
    sku: "PG-TEE-002",
    productType: " apparel ",
    vendor: null,
    tags: [],
    quantity: 1,
    lineSubtotalAmount: 50,
    lineDiscountAmount: 5,
  });

  assert.deepEqual(resolved, {
    amount: 18,
    source: "CATEGORY_DEFAULT_PRODUCT_TYPE",
  });
});

test("resolveLineItemCost falls back to vendor before tag when product type is missing", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [],
    categoryProfiles: [
      {
        categoryKey: "vendor::Acme Supply",
        defaultCostRate: "0.3000",
      },
      {
        categoryKey: "tag::Summer",
        defaultCostRate: "0.4500",
      },
    ],
    localVariantId: null,
    sku: "PG-TEE-004",
    productType: null,
    vendor: " acme   supply ",
    tags: ["Summer", "Promo"],
    quantity: 1,
    lineSubtotalAmount: 40,
    lineDiscountAmount: 0,
  });

  assert.deepEqual(resolved, {
    amount: 12,
    source: "CATEGORY_DEFAULT_VENDOR",
  });
});

test("resolveLineItemCost falls back to tag when product type and vendor are missing", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [],
    categoryProfiles: [
      {
        categoryKey: "tag::Summer",
        defaultCostRate: "0.4500",
      },
    ],
    localVariantId: null,
    sku: "PG-TEE-005",
    productType: null,
    vendor: null,
    tags: [" summer ", "Clearance"],
    quantity: 1,
    lineSubtotalAmount: 20,
    lineDiscountAmount: 0,
  });

  assert.deepEqual(resolved, {
    amount: 9,
    source: "CATEGORY_DEFAULT_TAG",
  });
});

test("resolveLineItemCost returns null when neither direct cost nor fallback rule exists", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [],
    categoryProfiles: [],
    localVariantId: null,
    sku: "PG-TEE-003",
    productType: "Accessories",
    vendor: "No Vendor",
    tags: ["Unknown"],
    quantity: 1,
    lineSubtotalAmount: 20,
    lineDiscountAmount: 0,
  });

  assert.equal(resolved, null);
});

test("resolveLineItemCost falls back to vendor and product type supplier contract before category defaults", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [
      {
        vendorName: "Profit Guard",
        productType: "Apparel",
        unitCostAmount: "7.2500",
      },
      {
        vendorName: "Profit Guard",
        productType: null,
        unitCostAmount: "8.0000",
      },
    ],
    categoryProfiles: [
      {
        categoryKey: "product_type::Apparel",
        defaultCostRate: "0.4000",
      },
    ],
    localVariantId: null,
    sku: "PG-TEE-006",
    productType: " Apparel ",
    vendor: "profit guard",
    tags: ["Featured"],
    quantity: 2,
    lineSubtotalAmount: 40,
    lineDiscountAmount: 0,
  });

  assert.deepEqual(resolved, {
    amount: 14.5,
    source: "SUPPLIER_CONTRACT_VENDOR_PRODUCT_TYPE",
  });
});

test("resolveLineItemCost falls back to vendor-wide supplier contract when product type contract is missing", () => {
  const resolved = resolveLineItemCost({
    candidates: [],
    supplierContracts: [
      {
        vendorName: "Profit Guard",
        productType: null,
        unitCostAmount: "8.0000",
      },
    ],
    categoryProfiles: [
      {
        categoryKey: "product_type::Accessories",
        defaultCostRate: "0.3500",
      },
    ],
    localVariantId: null,
    sku: "PG-TEE-007",
    productType: "Accessories",
    vendor: " Profit   Guard ",
    tags: ["Core"],
    quantity: 1,
    lineSubtotalAmount: 18,
    lineDiscountAmount: 0,
  });

  assert.deepEqual(resolved, {
    amount: 8,
    source: "SUPPLIER_CONTRACT_VENDOR",
  });
});
