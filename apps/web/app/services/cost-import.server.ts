import db from "../db.server";
import {
  encodeCategoryProfileKey,
  normalizeCategoryKey,
  parseDefaultCostRateInput,
  type CategoryMatchScope,
} from "../../../../packages/db/src/category-cost";
import {
  normalizeSupplierContractProductType,
  normalizeSupplierContractVendor,
} from "../../../../packages/db/src/supplier-contract";
import { upsertCategoryCostProfile } from "./category-costs.server";
import { upsertSupplierContractProfile } from "./supplier-contracts.server";

export type CostImportMode = "PREVIEW" | "UPSERT" | "REPLACE";
export type CostImportBatchType = "DIRECT_COSTS" | "SUPPLIER_CONTRACTS" | "FALLBACK_RULES";

export type CostImportRow = {
  rowNumber: number;
  sku: string | null;
  shopifyVariantId: string | null;
  costAmount: string;
  currencyCode: string | null;
  notes: string | null;
};

export type CostImportError = {
  rowNumber: number;
  message: string;
};

export type FallbackRuleImportRow = {
  rowNumber: number;
  matchKey: string | null;
  matchScope: string | null;
  defaultCostRate: string;
  notes: string | null;
};

export type SupplierContractImportRow = {
  rowNumber: number;
  vendorName: string | null;
  productType: string | null;
  unitCostAmount: string;
  currencyCode: string | null;
  notes: string | null;
};

export type CostImportBatchListItem = {
  appliedCount: number;
  batchId: string;
  canRollback: boolean;
  createdAt: string;
  currencyCode: string | null;
  errorCount: number;
  fileName: string | null;
  importType: CostImportBatchType;
  mode: CostImportMode;
  previewRows: CostImportPreviewRow[];
  rolledBackAt: string | null;
  rowCount: number;
  status: "PREVIEW" | "APPLIED" | "ROLLED_BACK" | "FAILED";
};

export type CostImportPreviewRow = {
  currentState: string;
  currencyCode: string | null;
  key: string;
  notes: string | null;
  resolution: string;
  rowNumber: number;
  value: string;
};

type VariantLookup = {
  id: string;
  productTitle: string;
  sku: string | null;
  shopifyVariantId: string;
  title: string | null;
};

type ValidatedCostImportRow = {
  costAmount: string;
  currencyCode: string;
  notes: string | null;
  rowNumber: number;
  shopifyVariantId: string | null;
  sku: string | null;
};

type ValidatedFallbackRuleImportRow = {
  defaultCostRate: string;
  matchKey: string;
  matchScope: CategoryMatchScope;
  notes: string | null;
  rowNumber: number;
};

type ValidatedSupplierContractImportRow = {
  currencyCode: string;
  notes: string | null;
  productType: string | null;
  rowNumber: number;
  unitCostAmount: string;
  vendorName: string;
};

type ActiveVariantCostSnapshot = {
  confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  costAmount: string;
  currencyCode: string;
  effectiveFrom: string;
  importedBatchKey: string | null;
  notes: string | null;
  sku: string | null;
  sourceType: "MANUAL" | "CSV" | "CATEGORY_DEFAULT" | "ESTIMATED";
  variantId: string | null;
};

type CategoryProfileSnapshot = {
  categoryKey: string;
  defaultCostRate: string;
  importedBatchKey: string | null;
  notes: string | null;
};

type SupplierContractProfileSnapshot = {
  currencyCode: string;
  effectiveFrom: string;
  importedBatchKey: string | null;
  notes: string | null;
  productType: string | null;
  unitCostAmount: string;
  vendorName: string;
};

type PreparedDirectImport = {
  previewRows: CostImportPreviewRow[];
  resolvedRows: Array<
    ValidatedCostImportRow & {
      resolvedVariantId: string | null;
      resolvedVariantTitle: string | null;
      resolvedProductTitle: string | null;
      resolvedSku: string | null;
    }
  >;
};

type PreparedFallbackImport = {
  normalizedKeys: string[];
  previewRows: CostImportPreviewRow[];
  resolvedRows: ValidatedFallbackRuleImportRow[];
};

type PreparedSupplierContractImport = {
  previewRows: CostImportPreviewRow[];
  resolvedRows: ValidatedSupplierContractImportRow[];
};

type CostImportBatchSummary = {
  notes?: string[];
  previewRows: CostImportPreviewRow[];
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeCell(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const nextCharacter = content[index + 1] ?? "";

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function resolveHeaderIndex(headers: string[], aliases: string[]) {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);

    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function parseImportedMatchScope(value: string | null | undefined): CategoryMatchScope | null {
  const normalizedValue = normalizeHeader(value ?? "");

  switch (normalizedValue) {
    case "product_type":
    case "producttype":
      return "PRODUCT_TYPE";
    case "vendor":
      return "VENDOR";
    case "tag":
      return "TAG";
    default:
      return null;
  }
}

function resolveMode(value: FormDataEntryValue | string | null | undefined): CostImportMode {
  const normalizedValue = String(value ?? "")
    .trim()
    .toUpperCase();

  switch (normalizedValue) {
    case "PREVIEW":
      return "PREVIEW";
    case "REPLACE":
      return "REPLACE";
    default:
      return "UPSERT";
  }
}

function formatImportTypeLabel(importType: CostImportBatchType) {
  switch (importType) {
    case "DIRECT_COSTS":
      return "Direct costs";
    case "SUPPLIER_CONTRACTS":
      return "Supplier contracts";
    default:
      return "Fallback rules";
  }
}

function formatModeLabel(mode: CostImportMode) {
  switch (mode) {
    case "PREVIEW":
      return "Preview";
    case "REPLACE":
      return "Replace";
    default:
      return "Upsert";
  }
}

function createSummary(args: {
  notes?: string[];
  previewRows: CostImportPreviewRow[];
}): CostImportBatchSummary {
  return {
    notes: args.notes,
    previewRows: args.previewRows,
  };
}

function parseSummary(value: unknown): CostImportBatchSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { previewRows: [] };
  }

  const candidate = value as {
    notes?: unknown;
    previewRows?: unknown;
  };

  const previewRows = Array.isArray(candidate.previewRows)
    ? candidate.previewRows.filter((row): row is CostImportPreviewRow => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return false;
        }

        const typedRow = row as Record<string, unknown>;

        return (
          typeof typedRow.rowNumber === "number" &&
          typeof typedRow.key === "string" &&
          typeof typedRow.value === "string" &&
          typeof typedRow.resolution === "string" &&
          typeof typedRow.currentState === "string"
        );
      })
    : [];

  return {
    notes: Array.isArray(candidate.notes)
      ? candidate.notes.filter((note): note is string => typeof note === "string")
      : undefined,
    previewRows,
  };
}

function serializeActiveVariantCosts(
  rows: Array<{
    confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
    costAmount: { toString(): string };
    currencyCode: string;
    effectiveFrom: Date;
    importedBatchKey: string | null;
    notes: string | null;
    sku: string | null;
    sourceType: "MANUAL" | "CSV" | "CATEGORY_DEFAULT" | "ESTIMATED";
    variantId: string | null;
  }>,
): ActiveVariantCostSnapshot[] {
  return rows.map((row) => ({
    confidenceLevel: row.confidenceLevel,
    costAmount: row.costAmount.toString(),
    currencyCode: row.currencyCode,
    effectiveFrom: row.effectiveFrom.toISOString(),
    importedBatchKey: row.importedBatchKey,
    notes: row.notes,
    sku: row.sku,
    sourceType: row.sourceType,
    variantId: row.variantId,
  }));
}

function serializeCategoryProfiles(
  rows: Array<{
    categoryKey: string;
    defaultCostRate: { toString(): string };
    importedBatchKey: string | null;
    notes: string | null;
  }>,
): CategoryProfileSnapshot[] {
  return rows.map((row) => ({
    categoryKey: row.categoryKey,
    defaultCostRate: row.defaultCostRate.toString(),
    importedBatchKey: row.importedBatchKey,
    notes: row.notes,
  }));
}

function serializeSupplierContractProfiles(
  rows: Array<{
    currencyCode: string;
    effectiveFrom: Date;
    importedBatchKey: string | null;
    notes: string | null;
    productType: string | null;
    unitCostAmount: { toString(): string };
    vendorName: string;
  }>,
): SupplierContractProfileSnapshot[] {
  return rows.map((row) => ({
    currencyCode: row.currencyCode,
    effectiveFrom: row.effectiveFrom.toISOString(),
    importedBatchKey: row.importedBatchKey,
    notes: row.notes,
    productType: row.productType,
    unitCostAmount: row.unitCostAmount.toString(),
    vendorName: row.vendorName,
  }));
}

function parseDirectRollbackSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      activeCostsBefore: [] as ActiveVariantCostSnapshot[],
    };
  }

  const candidate = value as {
    activeCostsBefore?: unknown;
  };

  const activeCostsBefore = Array.isArray(candidate.activeCostsBefore)
    ? candidate.activeCostsBefore.filter((row): row is ActiveVariantCostSnapshot => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return false;
        }

        const typedRow = row as Record<string, unknown>;

        return (
          (typedRow.variantId === null || typeof typedRow.variantId === "string") &&
          (typedRow.sku === null || typeof typedRow.sku === "string") &&
          typeof typedRow.sourceType === "string" &&
          typeof typedRow.costAmount === "string" &&
          typeof typedRow.currencyCode === "string" &&
          typeof typedRow.confidenceLevel === "string" &&
          typeof typedRow.effectiveFrom === "string"
        );
      })
    : [];

  return {
    activeCostsBefore,
  };
}

function parseFallbackRollbackSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      profilesBefore: [] as CategoryProfileSnapshot[],
    };
  }

  const candidate = value as {
    profilesBefore?: unknown;
  };

  const profilesBefore = Array.isArray(candidate.profilesBefore)
    ? candidate.profilesBefore.filter((row): row is CategoryProfileSnapshot => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return false;
        }

        const typedRow = row as Record<string, unknown>;

        return (
          typeof typedRow.categoryKey === "string" &&
          typeof typedRow.defaultCostRate === "string" &&
          (typedRow.notes === null || typeof typedRow.notes === "string") &&
          (typedRow.importedBatchKey === null || typeof typedRow.importedBatchKey === "string")
        );
      })
    : [];

  return {
    profilesBefore,
  };
}

function parseSupplierRollbackSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      profilesBefore: [] as SupplierContractProfileSnapshot[],
    };
  }

  const candidate = value as {
    profilesBefore?: unknown;
  };

  const profilesBefore = Array.isArray(candidate.profilesBefore)
    ? candidate.profilesBefore.filter((row): row is SupplierContractProfileSnapshot => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return false;
        }

        const typedRow = row as Record<string, unknown>;

        return (
          typeof typedRow.vendorName === "string" &&
          (typedRow.productType === null || typeof typedRow.productType === "string") &&
          typeof typedRow.unitCostAmount === "string" &&
          typeof typedRow.currencyCode === "string" &&
          typeof typedRow.effectiveFrom === "string" &&
          (typedRow.notes === null || typeof typedRow.notes === "string") &&
          (typedRow.importedBatchKey === null || typeof typedRow.importedBatchKey === "string")
        );
      })
    : [];

  return {
    profilesBefore,
  };
}

export function parseCostImportCsv(content: string) {
  const csvContent = content.replace(/^\uFEFF/, "");
  const rows = parseCsv(csvContent);

  if (rows.length === 0) {
    return {
      rows: [] as CostImportRow[],
      errors: [{ rowNumber: 0, message: "CSV is empty." }] as CostImportError[],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizeHeader(header));
  const skuIndex = resolveHeaderIndex(headers, ["sku", "variant_sku"]);
  const shopifyVariantIdIndex = resolveHeaderIndex(headers, [
    "shopify_variant_id",
    "variant_id",
    "variant_gid",
  ]);
  const costAmountIndex = resolveHeaderIndex(headers, ["cost_amount", "cost", "amount"]);
  const currencyCodeIndex = resolveHeaderIndex(headers, ["currency_code", "currency"]);
  const notesIndex = resolveHeaderIndex(headers, ["notes", "note"]);

  const errors: CostImportError[] = [];

  if (costAmountIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `cost_amount` column.",
    });
  }

  if (skuIndex < 0 && shopifyVariantIdIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "CSV must include `sku` or `shopify_variant_id`.",
    });
  }

  const parsedRows: CostImportRow[] = dataRows.map((row, offset) => ({
    rowNumber: offset + 2,
    sku: normalizeCell(skuIndex >= 0 ? row[skuIndex] : undefined),
    shopifyVariantId: normalizeCell(
      shopifyVariantIdIndex >= 0 ? row[shopifyVariantIdIndex] : undefined,
    ),
    costAmount: normalizeCell(row[costAmountIndex]) ?? "",
    currencyCode: normalizeCell(currencyCodeIndex >= 0 ? row[currencyCodeIndex] : undefined),
    notes: normalizeCell(notesIndex >= 0 ? row[notesIndex] : undefined),
  }));

  return {
    rows: parsedRows,
    errors,
  };
}

export function parseFallbackRuleImportCsv(content: string) {
  const csvContent = content.replace(/^\uFEFF/, "");
  const rows = parseCsv(csvContent);

  if (rows.length === 0) {
    return {
      rows: [] as FallbackRuleImportRow[],
      errors: [{ rowNumber: 0, message: "CSV is empty." }] as CostImportError[],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizeHeader(header));
  const matchScopeIndex = resolveHeaderIndex(headers, [
    "match_scope",
    "scope",
    "rule_scope",
    "category_scope",
  ]);
  const matchKeyIndex = resolveHeaderIndex(headers, [
    "match_key",
    "key",
    "value",
    "match_value",
    "category_key",
  ]);
  const defaultCostRateIndex = resolveHeaderIndex(headers, [
    "default_cost_rate",
    "cost_rate",
    "default_rate",
    "rate",
  ]);
  const notesIndex = resolveHeaderIndex(headers, ["notes", "note"]);

  const errors: CostImportError[] = [];

  if (matchScopeIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `match_scope` column.",
    });
  }

  if (matchKeyIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `match_key` column.",
    });
  }

  if (defaultCostRateIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `default_cost_rate` column.",
    });
  }

  const parsedRows: FallbackRuleImportRow[] = dataRows.map((row, offset) => ({
    rowNumber: offset + 2,
    matchKey: normalizeCell(matchKeyIndex >= 0 ? row[matchKeyIndex] : undefined),
    matchScope: normalizeCell(matchScopeIndex >= 0 ? row[matchScopeIndex] : undefined),
    defaultCostRate: normalizeCell(row[defaultCostRateIndex]) ?? "",
    notes: normalizeCell(notesIndex >= 0 ? row[notesIndex] : undefined),
  }));

  return {
    rows: parsedRows,
    errors,
  };
}

export function parseSupplierContractImportCsv(content: string) {
  const csvContent = content.replace(/^\uFEFF/, "");
  const rows = parseCsv(csvContent);

  if (rows.length === 0) {
    return {
      rows: [] as SupplierContractImportRow[],
      errors: [{ rowNumber: 0, message: "CSV is empty." }] as CostImportError[],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizeHeader(header));
  const vendorNameIndex = resolveHeaderIndex(headers, [
    "vendor_name",
    "vendor",
    "supplier_name",
    "supplier",
  ]);
  const productTypeIndex = resolveHeaderIndex(headers, ["product_type", "producttype"]);
  const unitCostAmountIndex = resolveHeaderIndex(headers, [
    "unit_cost_amount",
    "unit_cost",
    "cost_amount",
    "amount",
  ]);
  const currencyCodeIndex = resolveHeaderIndex(headers, ["currency_code", "currency"]);
  const notesIndex = resolveHeaderIndex(headers, ["notes", "note"]);

  const errors: CostImportError[] = [];

  if (vendorNameIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `vendor_name` column.",
    });
  }

  if (unitCostAmountIndex < 0) {
    errors.push({
      rowNumber: 0,
      message: "Missing required `unit_cost_amount` column.",
    });
  }

  const parsedRows: SupplierContractImportRow[] = dataRows.map((row, offset) => ({
    rowNumber: offset + 2,
    vendorName: normalizeCell(vendorNameIndex >= 0 ? row[vendorNameIndex] : undefined),
    productType: normalizeCell(productTypeIndex >= 0 ? row[productTypeIndex] : undefined),
    unitCostAmount: normalizeCell(row[unitCostAmountIndex]) ?? "",
    currencyCode: normalizeCell(currencyCodeIndex >= 0 ? row[currencyCodeIndex] : undefined),
    notes: normalizeCell(notesIndex >= 0 ? row[notesIndex] : undefined),
  }));

  return {
    rows: parsedRows,
    errors,
  };
}

export function validateCostImportRows(args: {
  defaultCurrencyCode: string;
  rows: CostImportRow[];
}) {
  const errors: CostImportError[] = [];
  const validatedRows: ValidatedCostImportRow[] = [];
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();

  for (const row of args.rows) {
    const amountNumber = Number(row.costAmount);
    const currencyCode = (row.currencyCode ?? args.defaultCurrencyCode).trim().toUpperCase();
    const key = row.shopifyVariantId
      ? `variant:${row.shopifyVariantId}`
      : row.sku
        ? `sku:${row.sku}`
        : `row:${row.rowNumber}`;

    if (seenKeys.has(key)) {
      duplicateKeys.add(key);
    }
    seenKeys.add(key);

    if (!row.sku && !row.shopifyVariantId) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Each row needs `sku` or `shopify_variant_id`.",
      });
      continue;
    }

    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Cost amount must be a positive number.",
      });
      continue;
    }

    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Currency code must be a 3-letter ISO code.",
      });
      continue;
    }

    validatedRows.push({
      rowNumber: row.rowNumber,
      sku: row.sku,
      shopifyVariantId: row.shopifyVariantId,
      costAmount: amountNumber.toFixed(4),
      currencyCode,
      notes: row.notes,
    });
  }

  if (duplicateKeys.size > 0) {
    errors.push({
      rowNumber: 0,
      message: `Duplicate keys found in CSV: ${[...duplicateKeys].join(", ")}`,
    });
  }

  return {
    rows: duplicateKeys.size > 0 ? [] : validatedRows,
    errors,
  };
}

export function validateFallbackRuleImportRows(args: {
  rows: FallbackRuleImportRow[];
}) {
  const errors: CostImportError[] = [];
  const validatedRows: ValidatedFallbackRuleImportRow[] = [];
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();

  for (const row of args.rows) {
    const matchScope = parseImportedMatchScope(row.matchScope);
    const matchKey = normalizeCategoryKey(row.matchKey);

    if (!matchScope) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Match scope must be one of `product_type`, `vendor`, or `tag`.",
      });
      continue;
    }

    if (!matchKey) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Match key is required.",
      });
      continue;
    }

    const parsedRate = parseDefaultCostRateInput(row.defaultCostRate);

    if (parsedRate.error || !parsedRate.normalizedRate) {
      errors.push({
        rowNumber: row.rowNumber,
        message: parsedRate.error ?? "Default cost rate is invalid.",
      });
      continue;
    }

    const dedupeKey = encodeCategoryProfileKey(matchScope, matchKey).toLowerCase();

    if (seenKeys.has(dedupeKey)) {
      duplicateKeys.add(dedupeKey);
    }
    seenKeys.add(dedupeKey);

    validatedRows.push({
      rowNumber: row.rowNumber,
      matchKey,
      matchScope,
      defaultCostRate: parsedRate.normalizedRate,
      notes: row.notes,
    });
  }

  if (duplicateKeys.size > 0) {
    errors.push({
      rowNumber: 0,
      message: `Duplicate fallback rules found in CSV: ${[...duplicateKeys].join(", ")}`,
    });
  }

  return {
    rows: duplicateKeys.size > 0 ? [] : validatedRows,
    errors,
  };
}

export function validateSupplierContractImportRows(args: {
  defaultCurrencyCode: string;
  rows: SupplierContractImportRow[];
}) {
  const errors: CostImportError[] = [];
  const validatedRows: ValidatedSupplierContractImportRow[] = [];
  const duplicateKeys = new Set<string>();
  const seenKeys = new Set<string>();

  for (const row of args.rows) {
    const vendorName = normalizeSupplierContractVendor(row.vendorName);
    const productType = normalizeSupplierContractProductType(row.productType) || null;
    const unitCostAmount = Number(row.unitCostAmount);
    const currencyCode = (row.currencyCode ?? args.defaultCurrencyCode).trim().toUpperCase();
    const dedupeKey = `${vendorName.toLowerCase()}::${(productType ?? "").toLowerCase()}`;

    if (seenKeys.has(dedupeKey)) {
      duplicateKeys.add(dedupeKey);
    }
    seenKeys.add(dedupeKey);

    if (!vendorName) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Vendor name is required.",
      });
      continue;
    }

    if (!Number.isFinite(unitCostAmount) || unitCostAmount <= 0) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Unit cost amount must be a positive number.",
      });
      continue;
    }

    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      errors.push({
        rowNumber: row.rowNumber,
        message: "Currency code must be a 3-letter ISO code.",
      });
      continue;
    }

    validatedRows.push({
      currencyCode,
      notes: row.notes,
      productType,
      rowNumber: row.rowNumber,
      unitCostAmount: unitCostAmount.toFixed(4),
      vendorName,
    });
  }

  if (duplicateKeys.size > 0) {
    errors.push({
      rowNumber: 0,
      message: `Duplicate supplier contracts found in CSV: ${[...duplicateKeys].join(", ")}`,
    });
  }

  return {
    rows: duplicateKeys.size > 0 ? [] : validatedRows,
    errors,
  };
}

async function loadVariantLookup(args: {
  shopId: string;
  shopifyVariantIds: string[];
  skus: string[];
}) {
  const variants = await db.variant.findMany({
    where: {
      shopId: args.shopId,
      OR: [
        args.skus.length > 0
          ? {
              sku: {
                in: args.skus,
              },
            }
          : undefined,
        args.shopifyVariantIds.length > 0
          ? {
              shopifyVariantId: {
                in: args.shopifyVariantIds,
              },
            }
          : undefined,
      ].filter(Boolean) as Array<Record<string, unknown>>,
    },
    select: {
      id: true,
      product: {
        select: {
          title: true,
        },
      },
      shopifyVariantId: true,
      sku: true,
      title: true,
    },
  });

  const byShopifyVariantId = new Map<string, VariantLookup>();
  const bySku = new Map<string, VariantLookup[]>();

  for (const variant of variants) {
    const lookupEntry: VariantLookup = {
      id: variant.id,
      productTitle: variant.product.title,
      sku: variant.sku,
      shopifyVariantId: variant.shopifyVariantId,
      title: variant.title,
    };

    byShopifyVariantId.set(variant.shopifyVariantId, lookupEntry);

    if (variant.sku) {
      const current = bySku.get(variant.sku) ?? [];
      current.push(lookupEntry);
      bySku.set(variant.sku, current);
    }
  }

  return {
    byShopifyVariantId,
    bySku,
  };
}

async function prepareVariantCostImport(args: {
  defaultCurrencyCode: string;
  csvText: string;
  shopId: string;
}) {
  const parsed = parseCostImportCsv(args.csvText);

  if (parsed.errors.length > 0) {
    return {
      errors: parsed.errors,
      prepared: null as PreparedDirectImport | null,
    };
  }

  const validated = validateCostImportRows({
    rows: parsed.rows,
    defaultCurrencyCode: args.defaultCurrencyCode,
  });

  if (validated.errors.length > 0) {
    return {
      errors: validated.errors,
      prepared: null as PreparedDirectImport | null,
    };
  }

  const lookup = await loadVariantLookup({
    shopId: args.shopId,
    skus: validated.rows.map((row) => row.sku).filter((value): value is string => Boolean(value)),
    shopifyVariantIds: validated.rows
      .map((row) => row.shopifyVariantId)
      .filter((value): value is string => Boolean(value)),
  });

  const resolutionErrors: CostImportError[] = [];
  const activeCosts = await db.variantCost.findMany({
    where: {
      shopId: args.shopId,
      effectiveTo: null,
    },
    select: {
      costAmount: true,
      currencyCode: true,
      sku: true,
      sourceType: true,
      variantId: true,
    },
  });

  const activeCostByVariantId = new Map<string, (typeof activeCosts)[number]>();
  const activeCostBySku = new Map<string, (typeof activeCosts)[number]>();

  for (const activeCost of activeCosts) {
    if (activeCost.variantId) {
      activeCostByVariantId.set(activeCost.variantId, activeCost);
    }

    if (activeCost.sku) {
      activeCostBySku.set(activeCost.sku, activeCost);
    }
  }

  const preparedRows: PreparedDirectImport["resolvedRows"] = [];

  for (const row of validated.rows) {
    const byId = row.shopifyVariantId ? lookup.byShopifyVariantId.get(row.shopifyVariantId) ?? null : null;
    const bySkuMatches = row.sku ? lookup.bySku.get(row.sku) ?? [] : [];

    if (row.shopifyVariantId && !byId) {
      resolutionErrors.push({
        rowNumber: row.rowNumber,
        message: `Shopify variant not found: ${row.shopifyVariantId}`,
      });
      continue;
    }

    if (row.sku && bySkuMatches.length > 1) {
      resolutionErrors.push({
        rowNumber: row.rowNumber,
        message: `SKU is ambiguous inside this shop: ${row.sku}`,
      });
      continue;
    }

    if (row.shopifyVariantId && row.sku && byId && byId.sku && byId.sku !== row.sku) {
      resolutionErrors.push({
        rowNumber: row.rowNumber,
        message: "SKU and shopify_variant_id point to different variants.",
      });
      continue;
    }

    const resolvedVariant = byId ?? bySkuMatches[0] ?? null;

    preparedRows.push({
      ...row,
      resolvedProductTitle: resolvedVariant?.productTitle ?? null,
      resolvedSku: row.sku ?? resolvedVariant?.sku ?? null,
      resolvedVariantId: resolvedVariant?.id ?? null,
      resolvedVariantTitle: resolvedVariant?.title ?? null,
    });
  }

  if (resolutionErrors.length > 0) {
    return {
      errors: resolutionErrors,
      prepared: null as PreparedDirectImport | null,
    };
  }

  return {
    errors: [] as CostImportError[],
    prepared: {
      previewRows: preparedRows.map((row) => {
        const activeCost =
          (row.resolvedVariantId ? activeCostByVariantId.get(row.resolvedVariantId) : null) ??
          (row.resolvedSku ? activeCostBySku.get(row.resolvedSku) ?? null : null);

        return {
          rowNumber: row.rowNumber,
          key: row.shopifyVariantId ?? row.sku ?? `row:${row.rowNumber}`,
          value: `${row.currencyCode} ${row.costAmount}`,
          currencyCode: row.currencyCode,
          notes: row.notes,
          resolution: row.resolvedVariantId
            ? `${row.resolvedProductTitle ?? "Unknown product"} / ${row.resolvedVariantTitle ?? "Default"}`
            : `SKU only: ${row.resolvedSku ?? "Unknown SKU"}`,
          currentState: activeCost
            ? `${activeCost.sourceType} ${activeCost.currencyCode} ${activeCost.costAmount.toString()}`
            : "No active cost",
        };
      }),
      resolvedRows: preparedRows,
    },
  };
}

async function prepareFallbackRuleImport(args: {
  csvText: string;
  shopId: string;
}) {
  const parsed = parseFallbackRuleImportCsv(args.csvText);

  if (parsed.errors.length > 0) {
    return {
      errors: parsed.errors,
      prepared: null as PreparedFallbackImport | null,
    };
  }

  const validated = validateFallbackRuleImportRows({
    rows: parsed.rows,
  });

  if (validated.errors.length > 0) {
    return {
      errors: validated.errors,
      prepared: null as PreparedFallbackImport | null,
    };
  }

  const existingProfiles = await db.categoryCostProfile.findMany({
    where: {
      shopId: args.shopId,
    },
    select: {
      categoryKey: true,
      defaultCostRate: true,
    },
  });

  const existingByKey = new Map(
    existingProfiles.map((profile) => [profile.categoryKey.toLowerCase(), profile.defaultCostRate.toString()]),
  );

  return {
    errors: [] as CostImportError[],
    prepared: {
      normalizedKeys: validated.rows.map((row) => encodeCategoryProfileKey(row.matchScope, row.matchKey)),
      previewRows: validated.rows.map((row) => {
        const categoryKey = encodeCategoryProfileKey(row.matchScope, row.matchKey);
        const currentRate = existingByKey.get(categoryKey.toLowerCase()) ?? null;

        return {
          rowNumber: row.rowNumber,
          key: categoryKey,
          value: row.defaultCostRate,
          currencyCode: null,
          notes: row.notes,
          resolution: `${row.matchScope} → ${row.matchKey}`,
          currentState: currentRate ? `Current rate ${currentRate}` : "New rule",
        };
      }),
      resolvedRows: validated.rows,
    },
  };
}

function formatSupplierContractPreviewKey(row: {
  productType: string | null;
  vendorName: string;
}) {
  return row.productType ? `${row.vendorName} / ${row.productType}` : row.vendorName;
}

async function prepareSupplierContractImport(args: {
  csvText: string;
  defaultCurrencyCode: string;
  shopId: string;
}) {
  const parsed = parseSupplierContractImportCsv(args.csvText);

  if (parsed.errors.length > 0) {
    return {
      errors: parsed.errors,
      prepared: null as PreparedSupplierContractImport | null,
    };
  }

  const validated = validateSupplierContractImportRows({
    defaultCurrencyCode: args.defaultCurrencyCode,
    rows: parsed.rows,
  });

  if (validated.errors.length > 0) {
    return {
      errors: validated.errors,
      prepared: null as PreparedSupplierContractImport | null,
    };
  }

  const existingProfiles = await db.supplierContractProfile.findMany({
    where: {
      shopId: args.shopId,
      effectiveTo: null,
    },
    select: {
      currencyCode: true,
      productType: true,
      unitCostAmount: true,
      vendorName: true,
    },
  });

  const existingByKey = new Map(
    existingProfiles.map((profile) => [
      `${normalizeSupplierContractVendor(profile.vendorName).toLowerCase()}::${normalizeSupplierContractProductType(profile.productType).toLowerCase()}`,
      {
        currencyCode: profile.currencyCode,
        unitCostAmount: profile.unitCostAmount.toString(),
      },
    ]),
  );

  return {
    errors: [] as CostImportError[],
    prepared: {
      previewRows: validated.rows.map((row) => {
        const dedupeKey = `${row.vendorName.toLowerCase()}::${(row.productType ?? "").toLowerCase()}`;
        const currentProfile = existingByKey.get(dedupeKey) ?? null;

        return {
          rowNumber: row.rowNumber,
          key: formatSupplierContractPreviewKey(row),
          value: `${row.unitCostAmount} ${row.currencyCode}`,
          currencyCode: row.currencyCode,
          notes: row.notes,
          resolution: row.productType
            ? `Vendor + product type contract → ${row.vendorName} / ${row.productType}`
            : `Vendor contract → ${row.vendorName}`,
          currentState: currentProfile
            ? `Current unit cost ${currentProfile.unitCostAmount} ${currentProfile.currencyCode}`
            : "New contract",
        };
      }),
      resolvedRows: validated.rows,
    },
  };
}

async function createImportBatch(args: {
  appliedCount: number;
  currencyCode: string | null;
  errorCount: number;
  fileName: string | null;
  importType: CostImportBatchType;
  mode: CostImportMode;
  rollbackSummary: unknown;
  rowCount: number;
  shopId: string;
  status: "PREVIEW" | "APPLIED" | "FAILED";
  summary: CostImportBatchSummary;
}) {
  return db.costImportBatch.create({
    data: {
      appliedCount: args.appliedCount,
      currencyCode: args.currencyCode,
      errorCount: args.errorCount,
      fileName: args.fileName,
      importType: args.importType,
      mode: args.mode,
      rollbackSummary: args.rollbackSummary ?? undefined,
      rowCount: args.rowCount,
      shopId: args.shopId,
      status: args.status,
      summary: args.summary,
    },
  });
}

export async function importVariantCostsFromCsv(args: {
  csvText: string;
  defaultCurrencyCode: string;
  fileName?: string | null;
  mode?: CostImportMode | null;
  shopId: string;
}) {
  const mode = resolveMode(args.mode);
  const preparedResult = await prepareVariantCostImport({
    defaultCurrencyCode: args.defaultCurrencyCode,
    csvText: args.csvText,
    shopId: args.shopId,
  });

  if (preparedResult.errors.length > 0 || !preparedResult.prepared) {
    return {
      batchId: null,
      errors: preparedResult.errors,
      importedCount: 0,
      mode,
      previewRows: [] as CostImportPreviewRow[],
      processedCount: 0,
    };
  }

  const { prepared } = preparedResult;
  const summary = createSummary({
    notes:
      mode === "REPLACE"
        ? ["Replace mode retires all currently active CSV direct costs before applying the new file."]
        : mode === "PREVIEW"
          ? ["Preview mode validates and resolves rows without mutating any cost records."]
          : ["Upsert mode only touches rows present in the current CSV file."],
    previewRows: prepared.previewRows,
  });

  if (mode === "PREVIEW") {
    const batch = await createImportBatch({
      appliedCount: 0,
      currencyCode: args.defaultCurrencyCode,
      errorCount: 0,
      fileName: args.fileName ?? null,
      importType: "DIRECT_COSTS",
      mode,
      rollbackSummary: null,
      rowCount: prepared.resolvedRows.length,
      shopId: args.shopId,
      status: "PREVIEW",
      summary,
    });

    return {
      batchId: batch.id,
      errors: [] as CostImportError[],
      importedCount: 0,
      mode,
      previewRows: prepared.previewRows,
      processedCount: prepared.resolvedRows.length,
    };
  }

  const activeCostsBefore = await db.variantCost.findMany({
    where: {
      shopId: args.shopId,
      effectiveTo: null,
    },
    select: {
      confidenceLevel: true,
      costAmount: true,
      currencyCode: true,
      effectiveFrom: true,
      importedBatchKey: true,
      notes: true,
      sku: true,
      sourceType: true,
      variantId: true,
    },
  });

  const batch = await db.$transaction(async (tx) => {
    const createdBatch = await tx.costImportBatch.create({
      data: {
        appliedCount: prepared.resolvedRows.length,
        currencyCode: args.defaultCurrencyCode,
        errorCount: 0,
        fileName: args.fileName ?? null,
        importType: "DIRECT_COSTS",
        mode,
        rowCount: prepared.resolvedRows.length,
        shopId: args.shopId,
        status: "APPLIED",
        summary,
      },
    });

    const effectiveFrom = new Date();

    if (mode === "REPLACE") {
      await tx.variantCost.updateMany({
        where: {
          shopId: args.shopId,
          effectiveTo: null,
          sourceType: "CSV",
        },
        data: {
          effectiveTo: effectiveFrom,
        },
      });
    }

    for (const row of prepared.resolvedRows) {
      await tx.variantCost.updateMany({
        where: {
          shopId: args.shopId,
          effectiveTo: null,
          OR: [
            row.resolvedVariantId
              ? {
                  variantId: row.resolvedVariantId,
                }
              : undefined,
            row.resolvedSku
              ? {
                  sku: row.resolvedSku,
                }
              : undefined,
          ].filter(Boolean) as Array<{ sku?: string; variantId?: string }>,
        },
        data: {
          effectiveTo: effectiveFrom,
        },
      });

      await tx.variantCost.create({
        data: {
          confidenceLevel: "HIGH",
          costAmount: row.costAmount,
          currencyCode: row.currencyCode,
          effectiveFrom,
          importedBatchKey: createdBatch.id,
          notes: row.notes,
          shopId: args.shopId,
          sku: row.resolvedSku,
          sourceType: "CSV",
          variantId: row.resolvedVariantId,
        },
      });
    }

    return tx.costImportBatch.update({
      where: {
        id: createdBatch.id,
      },
      data: {
        rollbackSummary: {
          activeCostsBefore: serializeActiveVariantCosts(activeCostsBefore),
        },
      },
    });
  });

  return {
    batchId: batch.id,
    errors: [] as CostImportError[],
    importedCount: prepared.resolvedRows.length,
    mode,
    previewRows: prepared.previewRows,
    processedCount: prepared.resolvedRows.length,
  };
}

export async function importSupplierContractsFromCsv(args: {
  csvText: string;
  defaultCurrencyCode: string;
  fileName?: string | null;
  mode?: CostImportMode | null;
  shopId: string;
}) {
  const mode = resolveMode(args.mode);
  const preparedResult = await prepareSupplierContractImport({
    csvText: args.csvText,
    defaultCurrencyCode: args.defaultCurrencyCode,
    shopId: args.shopId,
  });

  if (preparedResult.errors.length > 0 || !preparedResult.prepared) {
    return {
      batchId: null,
      errors: preparedResult.errors,
      importedCount: 0,
      mode,
      previewRows: [] as CostImportPreviewRow[],
      processedCount: 0,
    };
  }

  const { prepared } = preparedResult;
  const summary = createSummary({
    notes:
      mode === "REPLACE"
        ? ["Replace mode retires all currently active supplier contracts before applying the new file."]
        : mode === "PREVIEW"
          ? ["Preview mode validates and resolves supplier contract rows without mutating active profiles."]
          : ["Upsert mode only touches supplier contract scopes present in the current CSV file."],
    previewRows: prepared.previewRows,
  });

  if (mode === "PREVIEW") {
    const batch = await createImportBatch({
      appliedCount: 0,
      currencyCode: args.defaultCurrencyCode,
      errorCount: 0,
      fileName: args.fileName ?? null,
      importType: "SUPPLIER_CONTRACTS",
      mode,
      rollbackSummary: null,
      rowCount: prepared.resolvedRows.length,
      shopId: args.shopId,
      status: "PREVIEW",
      summary,
    });

    return {
      batchId: batch.id,
      errors: [] as CostImportError[],
      importedCount: 0,
      mode,
      previewRows: prepared.previewRows,
      processedCount: prepared.resolvedRows.length,
    };
  }

  const profilesBefore = await db.supplierContractProfile.findMany({
    where: {
      shopId: args.shopId,
      effectiveTo: null,
    },
    select: {
      currencyCode: true,
      effectiveFrom: true,
      importedBatchKey: true,
      notes: true,
      productType: true,
      unitCostAmount: true,
      vendorName: true,
    },
  });

  const batch = await db.$transaction(async (tx) => {
    const createdBatch = await tx.costImportBatch.create({
      data: {
        appliedCount: prepared.resolvedRows.length,
        currencyCode: args.defaultCurrencyCode,
        errorCount: 0,
        fileName: args.fileName ?? null,
        importType: "SUPPLIER_CONTRACTS",
        mode,
        rowCount: prepared.resolvedRows.length,
        shopId: args.shopId,
        status: "APPLIED",
        summary,
      },
    });

    const effectiveFrom = createdBatch.createdAt;

    if (mode === "REPLACE") {
      await tx.supplierContractProfile.updateMany({
        where: {
          shopId: args.shopId,
          effectiveTo: null,
        },
        data: {
          effectiveTo: effectiveFrom,
        },
      });
    }

    for (const row of prepared.resolvedRows) {
      await upsertSupplierContractProfile({
        client: tx,
        currencyCode: row.currencyCode,
        effectiveFrom,
        importedBatchKey: createdBatch.id,
        notes: row.notes,
        productType: row.productType,
        shopId: args.shopId,
        unitCostAmount: row.unitCostAmount,
        vendorName: row.vendorName,
      });
    }

    return tx.costImportBatch.update({
      where: {
        id: createdBatch.id,
      },
      data: {
        rollbackSummary: {
          profilesBefore: serializeSupplierContractProfiles(profilesBefore),
        },
      },
    });
  });

  return {
    batchId: batch.id,
    errors: [] as CostImportError[],
    importedCount: prepared.resolvedRows.length,
    mode,
    previewRows: prepared.previewRows,
    processedCount: prepared.resolvedRows.length,
  };
}

export async function importFallbackRulesFromCsv(args: {
  csvText: string;
  fileName?: string | null;
  mode?: CostImportMode | null;
  shopId: string;
}) {
  const mode = resolveMode(args.mode);
  const preparedResult = await prepareFallbackRuleImport({
    csvText: args.csvText,
    shopId: args.shopId,
  });

  if (preparedResult.errors.length > 0 || !preparedResult.prepared) {
    return {
      batchId: null,
      errors: preparedResult.errors,
      importedCount: 0,
      mode,
      previewRows: [] as CostImportPreviewRow[],
      processedCount: 0,
    };
  }

  const { prepared } = preparedResult;
  const summary = createSummary({
    notes:
      mode === "REPLACE"
        ? ["Replace mode replaces the full fallback-rule set with the current CSV file."]
        : mode === "PREVIEW"
          ? ["Preview mode validates and resolves rules without mutating fallback profiles."]
          : ["Upsert mode adds or updates only the rules present in the current CSV file."],
    previewRows: prepared.previewRows,
  });

  if (mode === "PREVIEW") {
    const batch = await createImportBatch({
      appliedCount: 0,
      currencyCode: null,
      errorCount: 0,
      fileName: args.fileName ?? null,
      importType: "FALLBACK_RULES",
      mode,
      rollbackSummary: null,
      rowCount: prepared.resolvedRows.length,
      shopId: args.shopId,
      status: "PREVIEW",
      summary,
    });

    return {
      batchId: batch.id,
      errors: [] as CostImportError[],
      importedCount: 0,
      mode,
      previewRows: prepared.previewRows,
      processedCount: prepared.resolvedRows.length,
    };
  }

  const profilesBefore = await db.categoryCostProfile.findMany({
    where: {
      shopId: args.shopId,
    },
    select: {
      categoryKey: true,
      defaultCostRate: true,
      importedBatchKey: true,
      notes: true,
    },
  });

  const batch = await db.$transaction(async (tx) => {
    const createdBatch = await tx.costImportBatch.create({
      data: {
        appliedCount: prepared.resolvedRows.length,
        errorCount: 0,
        fileName: args.fileName ?? null,
        importType: "FALLBACK_RULES",
        mode,
        rowCount: prepared.resolvedRows.length,
        shopId: args.shopId,
        status: "APPLIED",
        summary,
      },
    });

    for (const row of prepared.resolvedRows) {
      await upsertCategoryCostProfile({
        client: tx,
        defaultCostRateInput: row.defaultCostRate,
        importedBatchKey: createdBatch.id,
        matchKey: row.matchKey,
        matchScope: row.matchScope,
        notes: row.notes,
        shopId: args.shopId,
      });
    }

    if (mode === "REPLACE") {
      await tx.categoryCostProfile.deleteMany({
        where: {
          shopId: args.shopId,
          categoryKey: {
            notIn: prepared.normalizedKeys,
          },
        },
      });
    }

    return tx.costImportBatch.update({
      where: {
        id: createdBatch.id,
      },
      data: {
        rollbackSummary: {
          profilesBefore: serializeCategoryProfiles(profilesBefore),
        },
      },
    });
  });

  return {
    batchId: batch.id,
    errors: [] as CostImportError[],
    importedCount: prepared.resolvedRows.length,
    mode,
    previewRows: prepared.previewRows,
    processedCount: prepared.resolvedRows.length,
  };
}

export async function listRecentCostImportBatches(shopId: string) {
  const batches = await db.costImportBatch.findMany({
    where: {
      shopId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 12,
  });

  const latestAppliedByType = new Map<CostImportBatchType, string>();

  for (const batch of batches) {
    if (batch.status === "APPLIED" && !latestAppliedByType.has(batch.importType)) {
      latestAppliedByType.set(batch.importType, batch.id);
    }
  }

  return batches.map(
    (batch): CostImportBatchListItem => ({
      appliedCount: batch.appliedCount,
      batchId: batch.id,
      canRollback: batch.status === "APPLIED" && latestAppliedByType.get(batch.importType) === batch.id,
      createdAt: batch.createdAt.toISOString(),
      currencyCode: batch.currencyCode,
      errorCount: batch.errorCount,
      fileName: batch.fileName,
      importType: batch.importType,
      mode: batch.mode,
      previewRows: parseSummary(batch.summary).previewRows,
      rolledBackAt: batch.rolledBackAt?.toISOString() ?? null,
      rowCount: batch.rowCount,
      status: batch.status,
    }),
  );
}

async function assertBatchCanRollback(args: {
  batchId: string;
  importType: CostImportBatchType;
  shopId: string;
}) {
  const latestAppliedBatch = await db.costImportBatch.findFirst({
    where: {
      importType: args.importType,
      shopId: args.shopId,
      status: "APPLIED",
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
    },
  });

  if (!latestAppliedBatch || latestAppliedBatch.id !== args.batchId) {
    throw new Error("Only the most recent applied batch can be rolled back safely.");
  }
}

export async function rollbackCostImportBatch(args: {
  batchId: string;
  shopId: string;
}) {
  const batch = await db.costImportBatch.findFirst({
    where: {
      id: args.batchId,
      shopId: args.shopId,
    },
  });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  if (batch.status !== "APPLIED") {
    throw new Error("Only applied batches can be rolled back.");
  }

  await assertBatchCanRollback({
    batchId: batch.id,
    importType: batch.importType,
    shopId: args.shopId,
  });

  const rollbackTime = new Date();

  if (batch.importType === "DIRECT_COSTS") {
    const newerActiveCosts = await db.variantCost.count({
      where: {
        shopId: args.shopId,
        effectiveTo: null,
        effectiveFrom: {
          gt: batch.createdAt,
        },
        importedBatchKey: {
          not: batch.id,
        },
      },
    });

    if (newerActiveCosts > 0) {
      throw new Error("Newer direct cost changes were found after this batch. Rollback was blocked to avoid overwriting them.");
    }

    const rollbackSummary = parseDirectRollbackSummary(batch.rollbackSummary);

    await db.$transaction(async (tx) => {
      await tx.variantCost.updateMany({
        where: {
          shopId: args.shopId,
          effectiveTo: null,
        },
        data: {
          effectiveTo: rollbackTime,
        },
      });

      if (rollbackSummary.activeCostsBefore.length > 0) {
        await tx.variantCost.createMany({
          data: rollbackSummary.activeCostsBefore.map((row) => ({
            confidenceLevel: row.confidenceLevel,
            costAmount: row.costAmount,
            currencyCode: row.currencyCode,
            effectiveFrom: rollbackTime,
            importedBatchKey: row.importedBatchKey,
            notes: row.notes,
            shopId: args.shopId,
            sku: row.sku,
            sourceType: row.sourceType,
            variantId: row.variantId,
          })),
        });
      }

      await tx.costImportBatch.update({
        where: {
          id: batch.id,
        },
        data: {
          rolledBackAt: rollbackTime,
          status: "ROLLED_BACK",
        },
      });
    });

    return {
      importType: batch.importType,
      message: "Direct cost import rolled back. Previous active cost state has been restored.",
    };
  }

  if (batch.importType === "SUPPLIER_CONTRACTS") {
    const changeCutoff = batch.updatedAt;

    const newerSupplierProfiles = await db.supplierContractProfile.count({
      where: {
        shopId: args.shopId,
        updatedAt: {
          gt: changeCutoff,
        },
        OR: [
          {
            importedBatchKey: null,
          },
          {
            importedBatchKey: {
              not: batch.id,
            },
          },
        ],
      },
    });

    const mutatedBatchProfiles = await db.supplierContractProfile.count({
      where: {
        shopId: args.shopId,
        importedBatchKey: batch.id,
        effectiveTo: {
          not: null,
        },
        updatedAt: {
          gt: changeCutoff,
        },
      },
    });

    if (newerSupplierProfiles > 0 || mutatedBatchProfiles > 0) {
      throw new Error(
        "Newer supplier contract changes were found after this batch. Rollback was blocked to avoid overwriting them.",
      );
    }

    const rollbackSummary = parseSupplierRollbackSummary(batch.rollbackSummary);

    await db.$transaction(async (tx) => {
      await tx.supplierContractProfile.updateMany({
        where: {
          shopId: args.shopId,
          effectiveTo: null,
        },
        data: {
          effectiveTo: rollbackTime,
        },
      });

      if (rollbackSummary.profilesBefore.length > 0) {
        await tx.supplierContractProfile.createMany({
          data: rollbackSummary.profilesBefore.map((row) => ({
            currencyCode: row.currencyCode,
            effectiveFrom: rollbackTime,
            importedBatchKey: row.importedBatchKey,
            notes: row.notes,
            productType: row.productType,
            shopId: args.shopId,
            unitCostAmount: row.unitCostAmount,
            vendorName: row.vendorName,
          })),
        });
      }

      await tx.costImportBatch.update({
        where: {
          id: batch.id,
        },
        data: {
          rolledBackAt: rollbackTime,
          status: "ROLLED_BACK",
        },
      });
    });

    return {
      importType: batch.importType,
      message: "Supplier contract batch rolled back. Previous active contract set has been restored.",
    };
  }

  const newerFallbackProfiles = await db.categoryCostProfile.count({
    where: {
      shopId: args.shopId,
      updatedAt: {
        gt: batch.createdAt,
      },
      importedBatchKey: {
        not: batch.id,
      },
    },
  });

  if (newerFallbackProfiles > 0) {
    throw new Error("Newer fallback-rule changes were found after this batch. Rollback was blocked to avoid overwriting them.");
  }

  const rollbackSummary = parseFallbackRollbackSummary(batch.rollbackSummary);

  await db.$transaction(async (tx) => {
    await tx.categoryCostProfile.deleteMany({
      where: {
        shopId: args.shopId,
      },
    });

    if (rollbackSummary.profilesBefore.length > 0) {
      await tx.categoryCostProfile.createMany({
        data: rollbackSummary.profilesBefore.map((row) => ({
          categoryKey: row.categoryKey,
          defaultCostRate: row.defaultCostRate,
          importedBatchKey: row.importedBatchKey,
          notes: row.notes,
          shopId: args.shopId,
        })),
      });
    }

    await tx.costImportBatch.update({
      where: {
        id: batch.id,
      },
      data: {
        rolledBackAt: rollbackTime,
        status: "ROLLED_BACK",
      },
    });
  });

  return {
    importType: batch.importType,
    message: "Fallback-rule batch rolled back. Previous rule set has been restored.",
  };
}

function escapeCsvCell(value: string | null | undefined) {
  const text = value ?? "";

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

export async function buildCostImportBatchAuditCsv(args: {
  batchId: string;
  shopId: string;
}) {
  const batch = await db.costImportBatch.findFirst({
    where: {
      id: args.batchId,
      shopId: args.shopId,
    },
  });

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  const summary = parseSummary(batch.summary);
  const headers = [
    "batch_id",
    "created_at",
    "import_type",
    "mode",
    "status",
    "file_name",
    "row_number",
    "record_key",
    "value",
    "currency_code",
    "resolution",
    "current_state",
    "notes",
  ];

  const rows = summary.previewRows.map((row) =>
    [
      batch.id,
      batch.createdAt.toISOString(),
      formatImportTypeLabel(batch.importType),
      formatModeLabel(batch.mode),
      batch.status,
      batch.fileName ?? "",
      String(row.rowNumber),
      row.key,
      row.value,
      row.currencyCode ?? "",
      row.resolution,
      row.currentState,
      row.notes ?? "",
    ]
      .map((value) => escapeCsvCell(value))
      .join(","),
  );

  return {
    batch,
    csv: [headers.join(","), ...rows].join("\n"),
  };
}

export function getCostImportModeOptions() {
  return [
    {
      description: "Validate and inspect the CSV without writing to the database.",
      label: "Preview",
      value: "PREVIEW",
    },
    {
      description: "Add or update only the rows present in this file.",
      label: "Upsert",
      value: "UPSERT",
    },
    {
      description: "Replace the current imported batch set before applying this file.",
      label: "Replace",
      value: "REPLACE",
    },
  ] as const;
}

export function formatCostImportBatchLabel(batch: CostImportBatchListItem) {
  return `${formatImportTypeLabel(batch.importType)} · ${formatModeLabel(batch.mode)} · ${batch.status}`;
}

export { resolveMode };
