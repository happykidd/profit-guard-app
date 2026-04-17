import prisma from "../../../../packages/db/src/client";
import { resolveLineItemCost } from "../../../worker/src/services/cost-resolution";
import { getCostCenterSnapshot } from "../services/costs.server";
import {
  buildCostImportBatchAuditCsv,
  importSupplierContractsFromCsv,
  rollbackCostImportBatch,
} from "../services/cost-import.server";
import { upsertSupplierContractProfile } from "../services/supplier-contracts.server";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const shopDomain = `supplier-contract-batches-${Date.now()}.myshopify.com`;
  let createdShopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName: "Profit Guard Supplier Contract Batch Smoke Shop",
        currencyCode: "USD",
        ianaTimezone: "UTC",
        backfillStatus: "COMPLETED",
      },
    });
    createdShopId = shop.id;

    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        shopifyProductId: `gid://shopify/Product/${Date.now()}`,
        title: "Supplier Batch Tee",
        vendor: "Profit Guard",
        productType: "Apparel",
        tags: ["Core"],
      },
    });

    const variant = await prisma.variant.create({
      data: {
        shopId: shop.id,
        productId: product.id,
        shopifyVariantId: `gid://shopify/ProductVariant/${Date.now()}`,
        sku: "SUPPLIER-BATCH-001",
        title: "Default",
        priceAmount: "20.00",
      },
    });

    await upsertSupplierContractProfile({
      shopId: shop.id,
      vendorName: "Profit Guard",
      productType: null,
      unitCostAmount: "8.00",
      currencyCode: "USD",
      notes: "Original manual vendor contract",
    });

    const preview = await importSupplierContractsFromCsv({
      csvText: `vendor_name,product_type,unit_cost_amount,currency_code,notes
Profit Guard,Apparel,7.25,USD,Apparel contract
Profit Guard,,7.80,USD,Vendor fallback
`,
      defaultCurrencyCode: "USD",
      fileName: "supplier-preview.csv",
      mode: "PREVIEW",
      shopId: shop.id,
    });

    assertCondition(preview.mode === "PREVIEW", "Expected preview mode");
    assertCondition(preview.processedCount === 2, "Expected two preview rows");
    assertCondition(preview.previewRows.length === 2, "Expected preview rows to be returned");

    const applied = await importSupplierContractsFromCsv({
      csvText: `vendor_name,product_type,unit_cost_amount,currency_code,notes
Profit Guard,Apparel,7.25,USD,Apparel contract
Profit Guard,,7.80,USD,Vendor fallback
`,
      defaultCurrencyCode: "USD",
      fileName: "supplier-apply.csv",
      mode: "REPLACE",
      shopId: shop.id,
    });

    assertCondition(Boolean(applied.batchId), "Expected applied supplier batch id");
    assertCondition(applied.importedCount === 2, "Expected two supplier contracts to be applied");

    const audit = await buildCostImportBatchAuditCsv({
      batchId: applied.batchId ?? "",
      shopId: shop.id,
    });
    assertCondition(audit.csv.includes("Supplier contracts"), "Expected supplier contract audit label");
    assertCondition(audit.csv.includes("Profit Guard / Apparel"), "Expected apparel contract audit row");

    const importedSnapshot = await getCostCenterSnapshot(shopDomain);
    assertCondition(importedSnapshot, "Expected snapshot after supplier contract import");
    assertCondition(importedSnapshot.supplierProfiles.length === 2, "Expected two imported supplier contracts");
    assertCondition(
      importedSnapshot.supplierProfiles.every((profile) => profile.importedBatchKey === applied.batchId),
      "Expected imported supplier contracts to keep the batch id",
    );

    const importedResolved = resolveLineItemCost({
      candidates: [],
      supplierContracts: importedSnapshot.supplierProfiles.map((profile) => ({
        vendorName: profile.vendorName,
        productType: profile.productType,
        unitCostAmount: profile.unitCostAmount,
        currencyCode: profile.currencyCode,
      })),
      categoryProfiles: [],
      localVariantId: variant.id,
      sku: variant.sku,
      productType: "Apparel",
      vendor: "Profit Guard",
      tags: ["Core"],
      quantity: 2,
      lineSubtotalAmount: 40,
      lineDiscountAmount: 0,
    });
    assertCondition(
      importedResolved?.source === "SUPPLIER_CONTRACT_VENDOR_PRODUCT_TYPE",
      "Expected product-type supplier contract to win after import",
    );
    assertCondition(importedResolved.amount === 14.5, "Expected imported apparel unit cost to apply");

    await rollbackCostImportBatch({
      batchId: applied.batchId ?? "",
      shopId: shop.id,
    });

    const rolledBackSnapshot = await getCostCenterSnapshot(shopDomain);
    assertCondition(rolledBackSnapshot, "Expected snapshot after rollback");
    assertCondition(
      rolledBackSnapshot.supplierProfiles.length === 1,
      "Expected rollback to restore the original single supplier contract",
    );
    assertCondition(
      rolledBackSnapshot.supplierProfiles[0]?.importedBatchKey === null,
      "Expected restored supplier contract to return to manual state",
    );

    const rolledBackResolved = resolveLineItemCost({
      candidates: [],
      supplierContracts: rolledBackSnapshot.supplierProfiles.map((profile) => ({
        vendorName: profile.vendorName,
        productType: profile.productType,
        unitCostAmount: profile.unitCostAmount,
        currencyCode: profile.currencyCode,
      })),
      categoryProfiles: [],
      localVariantId: variant.id,
      sku: variant.sku,
      productType: "Apparel",
      vendor: "Profit Guard",
      tags: ["Core"],
      quantity: 2,
      lineSubtotalAmount: 40,
      lineDiscountAmount: 0,
    });
    assertCondition(
      rolledBackResolved?.source === "SUPPLIER_CONTRACT_VENDOR",
      "Expected rollback to restore the vendor-wide supplier contract",
    );
    assertCondition(rolledBackResolved.amount === 16, "Expected rollback to restore the original vendor-wide amount");

    console.info(
      JSON.stringify(
        {
          preview: {
            batchId: preview.batchId,
            processedCount: preview.processedCount,
            previewRows: preview.previewRows.length,
          },
          applied: {
            batchId: applied.batchId,
            importedCount: applied.importedCount,
            auditIncludesApparel: audit.csv.includes("Profit Guard / Apparel"),
          },
          importedSnapshot: importedSnapshot.supplierProfiles.map((profile) => ({
            displayValue: profile.displayValue,
            importedBatchKey: profile.importedBatchKey,
            unitCostAmount: profile.unitCostAmount,
          })),
          rolledBackSnapshot: rolledBackSnapshot.supplierProfiles.map((profile) => ({
            displayValue: profile.displayValue,
            importedBatchKey: profile.importedBatchKey,
            unitCostAmount: profile.unitCostAmount,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdShopId) {
      await prisma.shop.delete({
        where: {
          id: createdShopId,
        },
      });
    }

    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Supplier contract batches failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
