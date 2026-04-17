import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { parseCategoryProfileKey } from "../../../../packages/db/src/category-cost";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getCostImportTemplateCsv } from "../lib/cost-import-template";
import { getFallbackRuleImportTemplateCsv } from "../lib/fallback-rule-import-template";
import { getSupplierContractImportTemplateCsv } from "../lib/supplier-contract-import-template";
import {
  deleteCategoryCostProfile,
  upsertCategoryCostProfile,
} from "../services/category-costs.server";
import { getCostCenterSnapshot, upsertManualVariantCost } from "../services/costs.server";
import {
  deleteSupplierContractProfile,
  upsertSupplierContractProfile,
} from "../services/supplier-contracts.server";
import {
  importFallbackRulesFromCsv,
  importSupplierContractsFromCsv,
  importVariantCostsFromCsv,
  listRecentCostImportBatches,
  resolveMode,
  rollbackCostImportBatch,
} from "../services/cost-import.server";

type CostsActionData = {
  auditHref?: string | null;
  batchId?: string | null;
  details: string[];
  importedCount?: number;
  message: string;
  mode?: "PREVIEW" | "UPSERT" | "REPLACE";
  processedCount?: number;
  status: "success" | "error";
};

const importModeOptions = [
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

function formatImportBatchLabel(batch: {
  importType: "DIRECT_COSTS" | "SUPPLIER_CONTRACTS" | "FALLBACK_RULES";
  mode: "PREVIEW" | "UPSERT" | "REPLACE";
  status: "PREVIEW" | "APPLIED" | "ROLLED_BACK" | "FAILED";
}) {
  const importTypeLabel =
    batch.importType === "DIRECT_COSTS"
      ? "Direct costs"
      : batch.importType === "SUPPLIER_CONTRACTS"
        ? "Supplier contracts"
        : "Fallback rules";
  const modeLabel =
    batch.mode === "PREVIEW" ? "Preview" : batch.mode === "REPLACE" ? "Replace" : "Upsert";

  return `${importTypeLabel} · ${modeLabel} · ${batch.status}`;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value?: string | null, currencyCode = "USD") {
  if (!value) {
    return "Not available";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "Not available";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(numericValue);
}

function formatPercent(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "Not available";
  }

  const percentValue = numericValue * 100;
  const formatted = percentValue.toFixed(2).replace(/\.?0+$/, "");

  return `${formatted}%`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const snapshot = await getCostCenterSnapshot(session.shop);
  const shop = await db.shop.findUnique({
    where: {
      shopDomain: session.shop,
    },
    select: {
      id: true,
    },
  });
  const recentImports = shop ? await listRecentCostImportBatches(shop.id) : [];

  return snapshot
    ? {
        ...snapshot,
        recentImports,
      }
    : {
    activeCosts: [],
    categoryProfiles: [],
    costCoverageSummary: {
      categoryCoveredCount: 0,
      missingDirectCostCount: 0,
      supplierCoveredCount: 0,
      uncoveredCount: 0,
    },
    currencyCode: "USD",
    missingCostVariants: [],
    observedFallbackValues: {
      productTypes: [],
      tags: [],
      vendors: [],
    },
    shopId: null,
    supplierProfiles: [],
    variants: [],
    recentImports,
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<CostsActionData> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "").trim();
  const variantId = String(formData.get("variantId") || "").trim() || null;
  const fallbackSku = String(formData.get("sku") || "").trim() || null;
  const costAmount = String(formData.get("costAmount") || "").trim();
  const currencyCode = String(formData.get("currencyCode") || "").trim().toUpperCase() || "USD";
  const notes = String(formData.get("notes") || "").trim() || null;
  const importFile = formData.get("costFile");
  const fallbackRuleFile = formData.get("fallbackRuleFile");
  const supplierContractFile = formData.get("supplierContractFile");
  const matchKey = String(formData.get("matchKey") || "").trim();
  const matchScope = String(formData.get("matchScope") || "PRODUCT_TYPE").trim();
  const defaultCostRate = String(formData.get("defaultCostRate") || "").trim();
  const categoryNotes = String(formData.get("categoryNotes") || "").trim() || null;
  const categoryProfileId = String(formData.get("categoryProfileId") || "").trim();
  const contractVendorName = String(formData.get("contractVendorName") || "").trim();
  const contractProductType = String(formData.get("contractProductType") || "").trim() || null;
  const contractUnitCostAmount = String(formData.get("contractUnitCostAmount") || "").trim();
  const contractCurrencyCode =
    String(formData.get("contractCurrencyCode") || "").trim().toUpperCase() || "USD";
  const contractNotes = String(formData.get("contractNotes") || "").trim() || null;
  const contractProfileId = String(formData.get("contractProfileId") || "").trim();
  const importMode = resolveMode(formData.get("importMode"));
  const fallbackImportMode = resolveMode(formData.get("fallbackImportMode"));
  const supplierContractImportMode = resolveMode(formData.get("supplierContractImportMode"));
  const supplierContractCurrencyCode =
    String(formData.get("supplierContractCurrencyCode") || "").trim().toUpperCase() || "USD";
  const batchId = String(formData.get("batchId") || "").trim();

  const shop = await db.shop.findUnique({
    where: {
      shopDomain: session.shop,
    },
    select: {
      id: true,
    },
  });

  if (!shop) {
    return {
      details: [],
      message: "Shop record not found.",
      status: "error" as const,
    };
  }

  if (intent === "manual_upsert") {
    if (!costAmount || Number(costAmount) <= 0) {
      return {
        details: [],
        message: "Cost amount must be greater than 0.",
        status: "error" as const,
      };
    }

    const variant = variantId
      ? await db.variant.findFirst({
          where: {
            id: variantId,
            shopId: shop.id,
          },
          select: {
            id: true,
            sku: true,
          },
        })
      : null;

    await upsertManualVariantCost({
      shopId: shop.id,
      variantId: variant?.id ?? null,
      sku: variant?.sku ?? fallbackSku,
      costAmount,
      currencyCode,
      notes,
    });

    return {
      details: [],
      message: "Manual cost saved.",
      status: "success" as const,
    };
  }

  if (intent === "csv_import") {
    if (!(importFile instanceof File) || importFile.size === 0) {
      return {
        details: [],
        message: "Please upload a CSV file first.",
        status: "error" as const,
      };
    }

    const result = await importVariantCostsFromCsv({
      defaultCurrencyCode: currencyCode,
      csvText: await importFile.text(),
      fileName: importFile.name,
      mode: importMode,
      shopId: shop.id,
    });

    if (result.errors.length > 0) {
      return {
        auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
        batchId: result.batchId,
        details: result.errors.map((error) =>
          error.rowNumber > 0 ? `Row ${error.rowNumber}: ${error.message}` : error.message,
        ),
        importedCount: result.importedCount,
        message: "Direct cost CSV import failed validation.",
        mode: result.mode,
        processedCount: result.processedCount,
        status: "error" as const,
      };
    }

    return {
      auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
      batchId: result.batchId,
      details:
        result.mode === "PREVIEW"
          ? result.previewRows.map(
              (row) =>
                `Row ${row.rowNumber}: ${row.key} -> ${row.resolution} | New ${row.value} | Current ${row.currentState}`,
            )
          : [],
      importedCount: result.importedCount,
      message:
        result.mode === "PREVIEW"
          ? `Direct cost CSV preview is ready. ${result.processedCount} rows validated.`
          : `Direct cost CSV import completed. ${result.importedCount} rows applied.`,
      mode: result.mode,
      processedCount: result.processedCount,
      status: "success" as const,
    };
  }

  if (intent === "supplier_contract_csv_import") {
    if (!(supplierContractFile instanceof File) || supplierContractFile.size === 0) {
      return {
        details: [],
        message: "Please upload a supplier contract CSV file first.",
        status: "error" as const,
      };
    }

    const result = await importSupplierContractsFromCsv({
      csvText: await supplierContractFile.text(),
      defaultCurrencyCode: supplierContractCurrencyCode,
      fileName: supplierContractFile.name,
      mode: supplierContractImportMode,
      shopId: shop.id,
    });

    if (result.errors.length > 0) {
      return {
        auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
        batchId: result.batchId,
        details: result.errors.map((error) =>
          error.rowNumber > 0 ? `Row ${error.rowNumber}: ${error.message}` : error.message,
        ),
        importedCount: result.importedCount,
        mode: result.mode,
        message: "Supplier contract import failed validation.",
        processedCount: result.processedCount,
        status: "error" as const,
      };
    }

    return {
      auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
      batchId: result.batchId,
      details:
        result.mode === "PREVIEW"
          ? result.previewRows.map(
              (row) =>
                `Row ${row.rowNumber}: ${row.resolution} | New ${row.value} | Current ${row.currentState}`,
            )
          : [],
      importedCount: result.importedCount,
      message:
        result.mode === "PREVIEW"
          ? `Supplier contract preview is ready. ${result.processedCount} rows validated.`
          : `Supplier contract import completed. ${result.importedCount} contracts applied.`,
      mode: result.mode,
      processedCount: result.processedCount,
      status: "success" as const,
    };
  }

  if (intent === "fallback_csv_import") {
    if (!(fallbackRuleFile instanceof File) || fallbackRuleFile.size === 0) {
      return {
        details: [],
        message: "Please upload a fallback rule CSV file first.",
        status: "error" as const,
      };
    }

    const result = await importFallbackRulesFromCsv({
      csvText: await fallbackRuleFile.text(),
      fileName: fallbackRuleFile.name,
      mode: fallbackImportMode,
      shopId: shop.id,
    });

    if (result.errors.length > 0) {
      return {
        auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
        batchId: result.batchId,
        details: result.errors.map((error) =>
          error.rowNumber > 0 ? `Row ${error.rowNumber}: ${error.message}` : error.message,
        ),
        importedCount: result.importedCount,
        mode: result.mode,
        message: "Fallback rule import failed validation.",
        processedCount: result.processedCount,
        status: "error" as const,
      };
    }

    return {
      auditHref: result.batchId ? `/app/costs/audit?batchId=${result.batchId}` : null,
      batchId: result.batchId,
      details:
        result.mode === "PREVIEW"
          ? result.previewRows.map(
              (row) =>
                `Row ${row.rowNumber}: ${row.resolution} | New ${row.value} | Current ${row.currentState}`,
            )
          : [],
      importedCount: result.importedCount,
      message:
        result.mode === "PREVIEW"
          ? `Fallback rule preview is ready. ${result.processedCount} rows validated.`
          : `Fallback rule import completed. ${result.importedCount} rules applied.`,
      mode: result.mode,
      processedCount: result.processedCount,
      status: "success" as const,
    };
  }

  if (intent === "rollback_batch") {
    try {
      const result = await rollbackCostImportBatch({
        batchId,
        shopId: shop.id,
      });

      return {
        auditHref: `/app/costs/audit?batchId=${batchId}`,
        batchId,
        details: [],
        message: result.message,
        status: "success" as const,
      };
    } catch (error) {
      return {
        auditHref: batchId ? `/app/costs/audit?batchId=${batchId}` : null,
        batchId,
        details: [],
        message: error instanceof Error ? error.message : "Rollback failed.",
        status: "error" as const,
      };
    }
  }

  if (intent === "category_upsert") {
    try {
      const profile = await upsertCategoryCostProfile({
        shopId: shop.id,
        matchKey,
        matchScope,
        defaultCostRateInput: defaultCostRate,
        notes: categoryNotes,
      });
      const parsedProfile = parseCategoryProfileKey(profile.categoryKey);

      return {
        details: [],
        message: `Fallback rule saved for ${parsedProfile.displayLabel}: ${parsedProfile.key}.`,
        status: "success" as const,
      };
    } catch (error) {
      return {
        details: [],
        message: error instanceof Error ? error.message : "Category default save failed.",
        status: "error" as const,
      };
    }
  }

  if (intent === "category_delete") {
    try {
      await deleteCategoryCostProfile({
        shopId: shop.id,
        profileId: categoryProfileId,
      });

      return {
        details: [],
        message: "Category default removed.",
        status: "success" as const,
      };
    } catch (error) {
      return {
        details: [],
        message: error instanceof Error ? error.message : "Category default delete failed.",
        status: "error" as const,
      };
    }
  }

  if (intent === "contract_upsert") {
    try {
      await upsertSupplierContractProfile({
        shopId: shop.id,
        vendorName: contractVendorName,
        productType: contractProductType,
        unitCostAmount: contractUnitCostAmount,
        currencyCode: contractCurrencyCode,
        notes: contractNotes,
      });

      return {
        details: [],
        message: contractProductType
          ? `Supplier contract saved for ${contractVendorName} / ${contractProductType}.`
          : `Vendor-wide supplier contract saved for ${contractVendorName}.`,
        status: "success" as const,
      };
    } catch (error) {
      return {
        details: [],
        message: error instanceof Error ? error.message : "Supplier contract save failed.",
        status: "error" as const,
      };
    }
  }

  if (intent === "contract_delete") {
    try {
      await deleteSupplierContractProfile({
        shopId: shop.id,
        profileId: contractProfileId,
      });

      return {
        details: [],
        message: "Supplier contract profile retired.",
        status: "success" as const,
      };
    } catch (error) {
      return {
        details: [],
        message: error instanceof Error ? error.message : "Supplier contract delete failed.",
        status: "error" as const,
      };
    }
  }

  return {
    details: [],
    message: "Unsupported action.",
    status: "error" as const,
  };
};

export default function CostsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as CostsActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Cost Center">
      {actionData ? (
        <s-section heading={actionData.status === "success" ? "Latest cost center update" : "Cost center issue"}>
          <s-paragraph>
            <strong>{actionData.message}</strong>
          </s-paragraph>
          {"importedCount" in actionData && actionData.importedCount != null ? (
            <s-paragraph>
              Processed: {actionData.processedCount ?? actionData.importedCount} · Imported: {actionData.importedCount}
            </s-paragraph>
          ) : null}
          {actionData.mode ? (
            <s-paragraph>
              Mode: <strong>{actionData.mode}</strong>
            </s-paragraph>
          ) : null}
          {actionData.batchId ? (
            <s-paragraph>
              Batch: <code>{actionData.batchId}</code>
              {actionData.auditHref ? (
                <>
                  {" "}
                  · <s-link href={actionData.auditHref}>Download audit CSV</s-link>
                </>
              ) : null}
            </s-paragraph>
          ) : null}
          {actionData.details.length > 0 ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {actionData.details.map((detail) => (
                <s-box
                  key={detail}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  {detail}
                </s-box>
              ))}
            </div>
          ) : null}
        </s-section>
      ) : null}

      <s-section heading="Manual SKU cost update">
        <s-paragraph>
          Start with a manual SKU cost when you only need to patch one item. If your supplier already has a spreadsheet, the CSV flows below are faster and easier to audit.
        </s-paragraph>

        <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <input type="hidden" name="intent" value="manual_upsert" />
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Variant</span>
            <select
              name="variantId"
              defaultValue=""
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            >
              <option value="">Select a variant</option>
              {data.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.productTitle} / {variant.title || "Default"} / {variant.sku || "No SKU"}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Fallback SKU</span>
            <input
              type="text"
              name="sku"
              placeholder="Optional when variant has SKU"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Cost amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="costAmount"
                required
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Currency</span>
              <input
                type="text"
                name="currencyCode"
                defaultValue={data.currencyCode}
                maxLength={3}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Notes</span>
            <textarea
              name="notes"
              rows={3}
              placeholder="Example: supplier invoice 2026-04"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #111827",
              borderRadius: "999px",
              padding: "0.7rem 1rem",
              background: "#111827",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            {isSubmitting ? "Saving..." : "Save manual cost"}
          </button>
        </Form>
      </s-section>

      <s-section heading="Direct cost CSV import">
        <s-paragraph>
          Supported columns: <code>sku</code>, <code>shopify_variant_id</code>, <code>cost_amount</code>, <code>currency_code</code>, and <code>notes</code>.
        </s-paragraph>
        <s-paragraph>
          Provide at least one of <code>sku</code> or <code>shopify_variant_id</code>. Duplicate keys are rejected during validation.
        </s-paragraph>
        <s-paragraph>
          Import modes: <code>Preview</code> validates only. <code>Upsert</code> updates only the rows in the current file. <code>Replace</code> retires the current active CSV direct costs before applying the new file.
        </s-paragraph>

        <Form
          method="post"
          encType="multipart/form-data"
          style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}
        >
          <input type="hidden" name="intent" value="csv_import" />
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>CSV file</span>
            <input
              type="file"
              name="costFile"
              accept=".csv,text/csv"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Default currency</span>
            <input
              type="text"
              name="currencyCode"
              defaultValue={data.currencyCode}
              maxLength={3}
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Import mode</span>
            <select
              name="importMode"
              defaultValue="UPSERT"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            >
              {importModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #0f766e",
              borderRadius: "999px",
              padding: "0.7rem 1rem",
              background: "#0f766e",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            {isSubmitting ? "Running..." : "Run direct cost import"}
          </button>
        </Form>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <strong>Template</strong>
          <pre style={{ margin: "0.75rem 0 0", whiteSpace: "pre-wrap" }}>{getCostImportTemplateCsv()}</pre>
        </s-box>
      </s-section>

      <s-section heading="Supplier contract profiles">
        <s-paragraph>
          Use supplier contracts when a vendor has a stable landed unit cost but individual SKU costs are not complete yet. Profit Guard always prefers a more specific direct cost first; if none exists, it tries <code>vendor + productType</code>, then a vendor-level contract, and only then falls back to a percentage rule.
        </s-paragraph>
        <s-paragraph>
          Direct cost missing: {data.costCoverageSummary.missingDirectCostCount} · Covered by supplier contract:{" "}
          {data.costCoverageSummary.supplierCoveredCount} · Covered by fallback rule:{" "}
          {data.costCoverageSummary.categoryCoveredCount} · Still uncovered: {data.costCoverageSummary.uncoveredCount}
        </s-paragraph>

        <div style={{ display: "grid", gap: "1rem", marginBottom: "1rem", maxWidth: "40rem" }}>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>
              Supported columns for bulk import: <code>vendor_name</code>, <code>product_type</code>, <code>unit_cost_amount</code>, <code>currency_code</code>, and <code>notes</code>.
            </s-paragraph>
            <s-paragraph>
              Supplier contract imports support <code>Preview / Upsert / Replace</code> as well. <code>Replace</code> retires the current active contract set before applying the new file.
            </s-paragraph>

            <Form
              method="post"
              encType="multipart/form-data"
              style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}
            >
              <input type="hidden" name="intent" value="supplier_contract_csv_import" />
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Supplier contract CSV</span>
                <input
                  type="file"
                  name="supplierContractFile"
                  accept=".csv,text/csv"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Default currency</span>
                <input
                  type="text"
                  name="supplierContractCurrencyCode"
                  defaultValue={data.currencyCode}
                  maxLength={3}
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Import mode</span>
                <select
                  name="supplierContractImportMode"
                  defaultValue="UPSERT"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                >
                  {importModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                style={{
                  appearance: "none",
                  border: "1px solid #2563eb",
                  borderRadius: "999px",
                  padding: "0.7rem 1rem",
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                  width: "fit-content",
                }}
              >
                {isSubmitting ? "Running..." : "Run supplier contract import"}
              </button>
            </Form>

            <pre style={{ margin: "0.75rem 0 0", whiteSpace: "pre-wrap" }}>
              {getSupplierContractImportTemplateCsv()}
            </pre>
          </s-box>
        </div>

        <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <input type="hidden" name="intent" value="contract_upsert" />
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Vendor</span>
            <input
              type="text"
              name="contractVendorName"
              list="observed-vendors"
              placeholder="Example: Profit Guard"
              required
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
            <datalist id="observed-vendors">
              {data.observedFallbackValues.vendors.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Product type override</span>
            <input
              type="text"
              name="contractProductType"
              list="observed-product-types"
              placeholder="Optional, for vendor + product type contracts"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
            <datalist id="observed-product-types">
              {data.observedFallbackValues.productTypes.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Unit cost amount</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="contractUnitCostAmount"
                required
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>

            <label style={{ display: "grid", gap: "0.35rem" }}>
              <span>Currency</span>
              <input
                type="text"
                name="contractCurrencyCode"
                defaultValue={data.currencyCode}
                maxLength={3}
                style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Notes</span>
            <textarea
              name="contractNotes"
              rows={3}
              placeholder="Example: 2026 annual landed-cost contract"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #1d4ed8",
              borderRadius: "999px",
              padding: "0.7rem 1rem",
              background: "#1d4ed8",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            {isSubmitting ? "Saving..." : "Save supplier contract"}
          </button>
        </Form>

        {data.supplierProfiles.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
            {data.supplierProfiles.map((profile) => (
              <s-box
                key={profile.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{profile.displayLabel}</strong>
                <div>{profile.displayValue}</div>
                <div>Unit cost: {formatCurrency(profile.unitCostAmount, profile.currencyCode)}</div>
                <div>Effective from: {formatDate(profile.effectiveFrom)}</div>
                <div>Batch: {profile.importedBatchKey || "Manual entry"}</div>
                <div>Notes: {profile.notes || "None"}</div>
                <Form method="post" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="intent" value="contract_delete" />
                  <input type="hidden" name="contractProfileId" value={profile.id} />
                  <button
                    type="submit"
                    style={{
                      appearance: "none",
                      border: "1px solid #b91c1c",
                      borderRadius: "999px",
                      padding: "0.55rem 0.9rem",
                      background: "#ffffff",
                      color: "#b91c1c",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Retire contract
                  </button>
                </Form>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No supplier contract profiles yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Fallback cost rules">
        <s-paragraph>
          When a variant has no direct SKU cost, Profit Guard falls back in this order: <code>productType → vendor → tag</code>. The matched default rate is applied as <code>net sales × rate</code> to estimate product cost.
        </s-paragraph>
        <s-paragraph>
          Direct cost missing: {data.costCoverageSummary.missingDirectCostCount} · Covered by supplier contract:{" "}
          {data.costCoverageSummary.supplierCoveredCount} · Covered by fallback rule:{" "}
          {data.costCoverageSummary.categoryCoveredCount} · Still uncovered: {data.costCoverageSummary.uncoveredCount}
        </s-paragraph>

        <div style={{ display: "grid", gap: "1rem", marginBottom: "1rem", maxWidth: "40rem" }}>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-paragraph>
              Supported columns for bulk import: <code>match_scope</code>, <code>match_key</code>, <code>default_cost_rate</code>, and <code>notes</code>. <code>match_scope</code> currently supports <code>product_type</code>, <code>vendor</code>, and <code>tag</code>.
            </s-paragraph>
            <s-paragraph>
              Fallback rule imports also support <code>Preview / Upsert / Replace</code>. <code>Replace</code> swaps the current rule set with the rules in the uploaded CSV.
            </s-paragraph>

            <Form
              method="post"
              encType="multipart/form-data"
              style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}
            >
              <input type="hidden" name="intent" value="fallback_csv_import" />
              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Fallback rule CSV</span>
                <input
                  type="file"
                  name="fallbackRuleFile"
                  accept=".csv,text/csv"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                />
              </label>

              <label style={{ display: "grid", gap: "0.35rem" }}>
                <span>Import mode</span>
                <select
                  name="fallbackImportMode"
                  defaultValue="UPSERT"
                  style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
                >
                  {importModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                style={{
                  appearance: "none",
                  border: "1px solid #9a3412",
                  borderRadius: "999px",
                  padding: "0.7rem 1rem",
                  background: "#9a3412",
                  color: "#ffffff",
                  fontWeight: 600,
                  cursor: "pointer",
                  width: "fit-content",
                }}
              >
                {isSubmitting ? "Running..." : "Run fallback rule import"}
              </button>
            </Form>

            <pre style={{ margin: "0.75rem 0 0", whiteSpace: "pre-wrap" }}>
              {getFallbackRuleImportTemplateCsv()}
            </pre>
          </s-box>
        </div>

        <Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <input type="hidden" name="intent" value="category_upsert" />
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Match scope</span>
            <select
              name="matchScope"
              defaultValue="PRODUCT_TYPE"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            >
              <option value="PRODUCT_TYPE">Product type</option>
              <option value="VENDOR">Vendor</option>
              <option value="TAG">Tag</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Match value</span>
            <input
              type="text"
              name="matchKey"
              list="observed-fallback-options"
              placeholder="Example: Apparel / Acme Supply / Summer"
              required
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
            <datalist id="observed-fallback-options">
              {[
                ...data.observedFallbackValues.productTypes,
                ...data.observedFallbackValues.vendors,
                ...data.observedFallbackValues.tags,
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Default cost rate (%)</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              name="defaultCostRate"
              placeholder="Example: 42"
              required
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <label style={{ display: "grid", gap: "0.35rem" }}>
            <span>Notes</span>
            <textarea
              name="categoryNotes"
              rows={3}
              placeholder="Example: accessory category margin assumption"
              style={{ padding: "0.65rem 0.75rem", borderRadius: "0.75rem", border: "1px solid #d1d5db" }}
            />
          </label>

          <button
            type="submit"
            style={{
              appearance: "none",
              border: "1px solid #7c2d12",
              borderRadius: "999px",
              padding: "0.7rem 1rem",
              background: "#7c2d12",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            {isSubmitting ? "Saving..." : "Save fallback rule"}
          </button>
        </Form>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Observed product types</strong>
            <div>{data.observedFallbackValues.productTypes.join(", ") || "None yet"}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Observed vendors</strong>
            <div>{data.observedFallbackValues.vendors.join(", ") || "None yet"}</div>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <strong>Observed tags</strong>
            <div>{data.observedFallbackValues.tags.join(", ") || "None yet"}</div>
          </s-box>
        </div>

        {data.categoryProfiles.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
            {data.categoryProfiles.map((profile) => (
              <s-box
                key={profile.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>
                  {profile.displayLabel}: {profile.displayValue}
                </strong>
                <div>Default cost rate: {formatPercent(profile.defaultCostRate)}</div>
                <div>Updated: {formatDate(profile.updatedAt)}</div>
                <div>Batch: {profile.importedBatchKey || "Manual entry"}</div>
                <div>Notes: {profile.notes || "None"}</div>
                <Form method="post" style={{ marginTop: "0.75rem" }}>
                  <input type="hidden" name="intent" value="category_delete" />
                  <input type="hidden" name="categoryProfileId" value={profile.id} />
                  <button
                    type="submit"
                    style={{
                      appearance: "none",
                      border: "1px solid #b91c1c",
                      borderRadius: "999px",
                      padding: "0.55rem 0.9rem",
                      background: "#ffffff",
                      color: "#b91c1c",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Remove default
                  </button>
                </Form>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No fallback rules yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Recent import batches">
        <s-paragraph>
          This workspace keeps the preview, apply, and replace history for direct costs, supplier contracts, and fallback rules. Every batch can be exported as an audit CSV, and the newest applied batch supports a safe rollback.
        </s-paragraph>
        {data.recentImports.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.recentImports.map((batch) => (
              <s-box key={batch.batchId} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <strong>{formatImportBatchLabel(batch)}</strong>
                <div>Created: {formatDate(batch.createdAt)}</div>
                <div>Rows: {batch.rowCount} · Applied: {batch.appliedCount} · Errors: {batch.errorCount}</div>
                <div>File: {batch.fileName || "Inline / manual run"}</div>
                <div>Batch: {batch.batchId}</div>
                {batch.previewRows.length > 0 ? (
                  <div style={{ marginTop: "0.5rem" }}>
                    Preview rows:
                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                      {batch.previewRows.slice(0, 3).map((row) => (
                        <s-box
                          key={`${batch.batchId}-${row.rowNumber}-${row.key}`}
                          padding="base"
                          borderWidth="base"
                          borderRadius="base"
                          background="transparent"
                        >
                          Row {row.rowNumber}: {row.resolution} · New {row.value} · Current {row.currentState}
                        </s-box>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                  <s-link href={`/app/costs/audit?batchId=${batch.batchId}`}>Download audit CSV</s-link>
                  {batch.canRollback ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="rollback_batch" />
                      <input type="hidden" name="batchId" value={batch.batchId} />
                      <button
                        type="submit"
                        style={{
                          appearance: "none",
                          border: "1px solid #b91c1c",
                          borderRadius: "999px",
                          padding: "0.55rem 0.9rem",
                          background: "#ffffff",
                          color: "#b91c1c",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {isSubmitting ? "Rolling back..." : "Rollback batch"}
                      </button>
                    </Form>
                  ) : null}
                  {batch.rolledBackAt ? <div>Rolled back: {formatDate(batch.rolledBackAt)}</div> : null}
                </div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No preview or import batches yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Variants still missing any fallback coverage">
        {data.missingCostVariants.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.missingCostVariants.map((variant) => (
              <s-box
                key={variant.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{variant.productTitle}</strong>
                <div>Variant: {variant.title || "Default"}</div>
                <div>Category: {variant.productType || "No product type"}</div>
                <div>Vendor: {variant.vendor || "No vendor"}</div>
                <div>Tags: {variant.tags.join(", ") || "No tags"}</div>
                <div>SKU: {variant.sku || "No SKU"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>
            Current catalog already has either a direct cost row, a supplier contract match, or a fallback rule match.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Active direct cost records">
        {data.activeCosts.length > 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {data.activeCosts.map((cost) => (
              <s-box
                key={cost.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <strong>{cost.productTitle || "Unknown product"}</strong>
                <div>Variant: {cost.variantTitle || "Default"}</div>
                <div>Category: {cost.productType || "No product type"}</div>
                <div>Vendor: {cost.vendor || "No vendor"}</div>
                <div>Tags: {cost.tags.join(", ") || "No tags"}</div>
                <div>SKU: {cost.sku || "No SKU"}</div>
                <div>Amount: {formatCurrency(cost.costAmount, cost.currencyCode)}</div>
                <div>Source: {cost.sourceType}</div>
                <div>Confidence: {cost.confidenceLevel}</div>
                <div>Batch: {cost.importedBatchKey || "Manual entry"}</div>
                <div>Effective from: {formatDate(cost.effectiveFrom)}</div>
                <div>Notes: {cost.notes || "None"}</div>
              </s-box>
            ))}
          </div>
        ) : (
          <s-paragraph>No active cost records yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
