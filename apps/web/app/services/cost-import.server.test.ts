import assert from "node:assert/strict";
import test from "node:test";
import { getCostImportTemplateCsv } from "../lib/cost-import-template";
import { getFallbackRuleImportTemplateCsv } from "../lib/fallback-rule-import-template";
import { getSupplierContractImportTemplateCsv } from "../lib/supplier-contract-import-template";
import {
  formatCostImportBatchLabel,
  getCostImportModeOptions,
  parseFallbackRuleImportCsv,
  parseCostImportCsv,
  parseSupplierContractImportCsv,
  resolveMode,
  validateFallbackRuleImportRows,
  validateCostImportRows,
  validateSupplierContractImportRows,
} from "./cost-import.server";

test("parseCostImportCsv reads quoted CSV rows and normalized columns", () => {
  const parsed = parseCostImportCsv(`sku,cost_amount,currency_code,notes
"PG-TEE-001",10.50,usd,"Quoted, note"
`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 2,
    sku: "PG-TEE-001",
    shopifyVariantId: null,
    costAmount: "10.50",
    currencyCode: "usd",
    notes: "Quoted, note",
  });
});

test("validateCostImportRows rejects bad rows and duplicate keys", () => {
  const validated = validateCostImportRows({
    defaultCurrencyCode: "USD",
    rows: [
      {
        rowNumber: 2,
        sku: "PG-TEE-001",
        shopifyVariantId: null,
        costAmount: "-1",
        currencyCode: "USD",
        notes: null,
      },
      {
        rowNumber: 3,
        sku: "PG-TEE-001",
        shopifyVariantId: null,
        costAmount: "10",
        currencyCode: "USDX",
        notes: null,
      },
    ],
  });

  assert.equal(validated.rows.length, 0);
  assert.equal(validated.errors.length, 3);
});

test("validateCostImportRows normalizes amount precision and default currency", () => {
  const validated = validateCostImportRows({
    defaultCurrencyCode: "USD",
    rows: [
      {
        rowNumber: 2,
        sku: null,
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        costAmount: "10.5",
        currencyCode: null,
        notes: "batch 1",
      },
    ],
  });

  assert.equal(validated.errors.length, 0);
  assert.deepEqual(validated.rows[0], {
    rowNumber: 2,
    sku: null,
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    costAmount: "10.5000",
    currencyCode: "USD",
    notes: "batch 1",
  });
});

test("getCostImportTemplateCsv exposes expected import headers", () => {
  const template = getCostImportTemplateCsv();

  assert.match(template, /sku,shopify_variant_id,cost_amount,currency_code,notes/);
  assert.match(template, /PG-TEE-001/);
});

test("parseFallbackRuleImportCsv reads fallback rule rows", () => {
  const parsed = parseFallbackRuleImportCsv(`match_scope,match_key,default_cost_rate,notes
vendor,"Profit Guard",42,"Preferred, supplier"
`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 2,
    matchKey: "Profit Guard",
    matchScope: "vendor",
    defaultCostRate: "42",
    notes: "Preferred, supplier",
  });
});

test("validateFallbackRuleImportRows rejects bad scopes, rates, and duplicates", () => {
  const validated = validateFallbackRuleImportRows({
    rows: [
      {
        rowNumber: 2,
        matchKey: "Apparel",
        matchScope: "department",
        defaultCostRate: "35",
        notes: null,
      },
      {
        rowNumber: 3,
        matchKey: "Apparel",
        matchScope: "product_type",
        defaultCostRate: "35",
        notes: null,
      },
      {
        rowNumber: 4,
        matchKey: "apparel",
        matchScope: "product_type",
        defaultCostRate: "40",
        notes: null,
      },
      {
        rowNumber: 5,
        matchKey: "Clearance",
        matchScope: "tag",
        defaultCostRate: "0",
        notes: null,
      },
    ],
  });

  assert.equal(validated.rows.length, 0);
  assert.equal(validated.errors.length, 3);
});

test("validateFallbackRuleImportRows normalizes scope, key, and rate", () => {
  const validated = validateFallbackRuleImportRows({
    rows: [
      {
        rowNumber: 2,
        matchKey: "  Profit Guard  ",
        matchScope: "vendor",
        defaultCostRate: "42",
        notes: "sync import",
      },
    ],
  });

  assert.equal(validated.errors.length, 0);
  assert.deepEqual(validated.rows[0], {
    rowNumber: 2,
    matchKey: "Profit Guard",
    matchScope: "VENDOR",
    defaultCostRate: "0.4200",
    notes: "sync import",
  });
});

test("getFallbackRuleImportTemplateCsv exposes expected import headers", () => {
  const template = getFallbackRuleImportTemplateCsv();

  assert.match(template, /match_scope,match_key,default_cost_rate,notes/);
  assert.match(template, /product_type,Apparel,35/);
  assert.match(template, /vendor,Profit Guard,42/);
});

test("parseSupplierContractImportCsv reads supplier contract rows", () => {
  const parsed = parseSupplierContractImportCsv(`vendor_name,product_type,unit_cost_amount,currency_code,notes
"Profit Guard",Apparel,7.25,usd,"Contract, apparel"
`);

  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0], {
    rowNumber: 2,
    vendorName: "Profit Guard",
    productType: "Apparel",
    unitCostAmount: "7.25",
    currencyCode: "usd",
    notes: "Contract, apparel",
  });
});

test("validateSupplierContractImportRows rejects bad rows and duplicate scopes", () => {
  const validated = validateSupplierContractImportRows({
    defaultCurrencyCode: "USD",
    rows: [
      {
        rowNumber: 2,
        vendorName: null,
        productType: null,
        unitCostAmount: "7.25",
        currencyCode: "USD",
        notes: null,
      },
      {
        rowNumber: 3,
        vendorName: "Profit Guard",
        productType: "Apparel",
        unitCostAmount: "-1",
        currencyCode: "USD",
        notes: null,
      },
      {
        rowNumber: 4,
        vendorName: "Profit Guard",
        productType: "Apparel",
        unitCostAmount: "7.25",
        currencyCode: "USDX",
        notes: null,
      },
      {
        rowNumber: 5,
        vendorName: "profit guard",
        productType: "apparel",
        unitCostAmount: "7.80",
        currencyCode: "USD",
        notes: null,
      },
    ],
  });

  assert.equal(validated.rows.length, 0);
  assert.equal(validated.errors.length, 4);
});

test("validateSupplierContractImportRows normalizes vendor, product type, and currency", () => {
  const validated = validateSupplierContractImportRows({
    defaultCurrencyCode: "USD",
    rows: [
      {
        rowNumber: 2,
        vendorName: "  Profit   Guard ",
        productType: " Apparel ",
        unitCostAmount: "7.25",
        currencyCode: null,
        notes: "annual contract",
      },
    ],
  });

  assert.equal(validated.errors.length, 0);
  assert.deepEqual(validated.rows[0], {
    rowNumber: 2,
    vendorName: "Profit Guard",
    productType: "Apparel",
    unitCostAmount: "7.2500",
    currencyCode: "USD",
    notes: "annual contract",
  });
});

test("getSupplierContractImportTemplateCsv exposes expected import headers", () => {
  const template = getSupplierContractImportTemplateCsv();

  assert.match(template, /vendor_name,product_type,unit_cost_amount,currency_code,notes/);
  assert.match(template, /Profit Guard,Apparel,7.25,USD/);
  assert.match(template, /Profit Guard,,8.00,USD/);
});

test("resolveMode normalizes preview and replace values", () => {
  assert.equal(resolveMode("preview"), "PREVIEW");
  assert.equal(resolveMode("REPLACE"), "REPLACE");
  assert.equal(resolveMode("anything-else"), "UPSERT");
});

test("getCostImportModeOptions exposes the three supported run modes", () => {
  const modes = getCostImportModeOptions();

  assert.deepEqual(
    modes.map((mode) => mode.value),
    ["PREVIEW", "UPSERT", "REPLACE"],
  );
});

test("formatCostImportBatchLabel produces readable audit labels", () => {
  const label = formatCostImportBatchLabel({
    appliedCount: 2,
    batchId: "batch-1",
    canRollback: true,
    createdAt: new Date("2026-04-15T12:00:00Z").toISOString(),
    currencyCode: "USD",
    errorCount: 0,
    fileName: "direct-costs.csv",
    importType: "DIRECT_COSTS",
    mode: "REPLACE",
    previewRows: [],
    rolledBackAt: null,
    rowCount: 2,
    status: "APPLIED",
  });

  assert.equal(label, "Direct costs · Replace · APPLIED");
});

test("formatCostImportBatchLabel handles supplier contract imports", () => {
  const label = formatCostImportBatchLabel({
    appliedCount: 2,
    batchId: "batch-2",
    canRollback: true,
    createdAt: new Date("2026-04-15T12:00:00Z").toISOString(),
    currencyCode: "USD",
    errorCount: 0,
    fileName: "supplier-contracts.csv",
    importType: "SUPPLIER_CONTRACTS",
    mode: "UPSERT",
    previewRows: [],
    rolledBackAt: null,
    rowCount: 2,
    status: "APPLIED",
  });

  assert.equal(label, "Supplier contracts · Upsert · APPLIED");
});
