import db from "../db.server";
import { getCostImportTemplateCsv } from "../lib/cost-import-template";
import {
  importVariantCostsFromCsv,
} from "../services/cost-import.server";
import { getCostCenterSnapshot } from "../services/costs.server";

async function main() {
  const shopDomain = `cost-import-${Date.now()}.myshopify.com`;
  const shop = await db.shop.create({
    data: {
      shopDomain,
      shopName: "Cost Import Smoke Shop",
      currencyCode: "USD",
    },
  });

  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id,
        shopifyProductId: `gid://shopify/Product/${Date.now()}`,
        title: "Import Test Product",
      },
    });

    await db.variant.createMany({
      data: [
        {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/99001",
          sku: "CSV-SMOKE-001",
          title: "Blue / S",
        },
        {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/99002",
          sku: "CSV-SMOKE-002",
          title: "Blue / M",
        },
      ],
    });

    const result = await importVariantCostsFromCsv({
      shopId: shop.id,
      defaultCurrencyCode: "USD",
      fileName: "smoke-direct.csv",
      mode: "UPSERT",
      csvText: `sku,shopify_variant_id,cost_amount,currency_code,notes
CSV-SMOKE-001,,11.25,usd,First row
,gid://shopify/ProductVariant/99002,12.75,USD,Second row
`,
    });

    const snapshot = await getCostCenterSnapshot(shopDomain);

    console.info(
      JSON.stringify(
        {
          importedCount: result.importedCount,
          errors: result.errors,
          templateHeaders: getCostImportTemplateCsv().split("\n")[0],
          activeCosts: snapshot?.activeCosts.map((cost) => ({
            sku: cost.sku,
            costAmount: cost.costAmount,
            sourceType: cost.sourceType,
            importedBatchKey: cost.importedBatchKey,
          })),
          missingCostVariants: snapshot?.missingCostVariants.length ?? null,
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
  console.error("[smoke] Cost import failed", error);
  await db.$disconnect();
  process.exit(1);
});
