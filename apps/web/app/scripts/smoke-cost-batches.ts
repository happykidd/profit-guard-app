import db from "../db.server";
import {
  buildCostImportBatchAuditCsv,
  importFallbackRulesFromCsv,
  importVariantCostsFromCsv,
  listRecentCostImportBatches,
  rollbackCostImportBatch,
} from "../services/cost-import.server";
import { getCostCenterSnapshot, upsertManualVariantCost } from "../services/costs.server";

async function main() {
  const shopDomain = `cost-batches-${Date.now()}.myshopify.com`;
  const shop = await db.shop.create({
    data: {
      shopDomain,
      shopName: "Cost Batch Smoke Shop",
      currencyCode: "USD",
    },
  });

  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id,
        shopifyProductId: `gid://shopify/Product/${Date.now()}`,
        title: "Batch Test Product",
        productType: "Apparel",
      },
    });

    const [variantOne] = await Promise.all([
      db.variant.create({
        data: {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/88001",
          sku: "BATCH-SMOKE-001",
          title: "Black / S",
        },
      }),
      db.variant.create({
        data: {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/88002",
          sku: "BATCH-SMOKE-002",
          title: "Black / M",
        },
      }),
    ]);

    await upsertManualVariantCost({
      shopId: shop.id,
      variantId: variantOne.id,
      sku: variantOne.sku,
      costAmount: "9.50",
      currencyCode: "USD",
      notes: "Original manual cost",
    });

    await db.categoryCostProfile.create({
      data: {
        shopId: shop.id,
        categoryKey: "product_type:Apparel",
        defaultCostRate: "0.3500",
        notes: "Original apparel rule",
      },
    });

    const previewDirect = await importVariantCostsFromCsv({
      shopId: shop.id,
      defaultCurrencyCode: "USD",
      fileName: "preview-direct.csv",
      mode: "PREVIEW",
      csvText: `sku,cost_amount,currency_code,notes
BATCH-SMOKE-001,11.25,USD,Preview row
`,
    });

    const appliedDirect = await importVariantCostsFromCsv({
      shopId: shop.id,
      defaultCurrencyCode: "USD",
      fileName: "apply-direct.csv",
      mode: "UPSERT",
      csvText: `sku,shopify_variant_id,cost_amount,currency_code,notes
BATCH-SMOKE-001,,11.25,USD,Applied row one
,gid://shopify/ProductVariant/88002,12.75,USD,Applied row two
`,
    });

    const directAudit = await buildCostImportBatchAuditCsv({
      batchId: appliedDirect.batchId ?? "",
      shopId: shop.id,
    });

    const appliedFallback = await importFallbackRulesFromCsv({
      shopId: shop.id,
      fileName: "replace-fallback.csv",
      mode: "REPLACE",
      csvText: `match_scope,match_key,default_cost_rate,notes
vendor,Profit Guard,42,Vendor default
tag,Launch,55,Launch tag
`,
    });

    const beforeRollbackSnapshot = await getCostCenterSnapshot(shopDomain);

    await rollbackCostImportBatch({
      batchId: appliedDirect.batchId ?? "",
      shopId: shop.id,
    });

    await rollbackCostImportBatch({
      batchId: appliedFallback.batchId ?? "",
      shopId: shop.id,
    });

    const finalSnapshot = await getCostCenterSnapshot(shopDomain);
    const recentImports = await listRecentCostImportBatches(shop.id);

    console.info(
      JSON.stringify(
        {
          previewDirect: {
            batchId: previewDirect.batchId,
            mode: previewDirect.mode,
            previewRows: previewDirect.previewRows.length,
            processedCount: previewDirect.processedCount,
          },
          appliedDirect: {
            batchId: appliedDirect.batchId,
            importedCount: appliedDirect.importedCount,
            auditIncludesVariant: directAudit.csv.includes("BATCH-SMOKE-001"),
          },
          beforeRollbackSnapshot: {
            activeCosts: beforeRollbackSnapshot?.activeCosts.map((cost) => ({
              costAmount: cost.costAmount,
              sku: cost.sku,
              sourceType: cost.sourceType,
            })),
            categoryProfiles: beforeRollbackSnapshot?.categoryProfiles.map((profile) => ({
              key: profile.categoryKey,
              rate: profile.defaultCostRate,
            })),
          },
          finalSnapshot: {
            activeCosts: finalSnapshot?.activeCosts.map((cost) => ({
              costAmount: cost.costAmount,
              sku: cost.sku,
              sourceType: cost.sourceType,
            })),
            categoryProfiles: finalSnapshot?.categoryProfiles.map((profile) => ({
              key: profile.categoryKey,
              rate: profile.defaultCostRate,
            })),
          },
          recentImports: recentImports.map((batch) => ({
            batchId: batch.batchId,
            canRollback: batch.canRollback,
            importType: batch.importType,
            mode: batch.mode,
            status: batch.status,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await db.shop.delete({
      where: {
        id: shop.id,
      },
    });

    await db.$disconnect();
  }
}

main().catch(async (error) => {
  console.error("[smoke] Cost batch governance failed", error);
  await db.$disconnect();
  process.exit(1);
});
