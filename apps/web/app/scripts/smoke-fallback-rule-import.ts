import assert from "node:assert/strict";
import db from "../db.server";
import { getFallbackRuleImportTemplateCsv } from "../lib/fallback-rule-import-template";
import { importFallbackRulesFromCsv } from "../services/cost-import.server";
import { getCostCenterSnapshot } from "../services/costs.server";

async function main() {
  const shopDomain = `fallback-import-${Date.now()}.myshopify.com`;
  const shop = await db.shop.create({
    data: {
      shopDomain,
      shopName: "Fallback Import Smoke Shop",
      currencyCode: "USD",
    },
  });

  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id,
        shopifyProductId: `gid://shopify/Product/${Date.now()}`,
        title: "Fallback Import Product",
        productType: "Apparel",
        vendor: "Profit Guard",
        tags: ["smoke", "core", "clearance"],
      },
    });

    await db.variant.createMany({
      data: [
        {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/99101",
          sku: "FB-SMOKE-001",
          title: "Black / S",
        },
        {
          shopId: shop.id,
          productId: product.id,
          shopifyVariantId: "gid://shopify/ProductVariant/99102",
          sku: "FB-SMOKE-002",
          title: "Black / M",
        },
      ],
    });

    const result = await importFallbackRulesFromCsv({
      shopId: shop.id,
      csvText: `match_scope,match_key,default_cost_rate,notes
product_type,Apparel,35,Primary apparel fallback
vendor,Profit Guard,42,Vendor fallback
tag,clearance,60,Tag fallback
`,
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.importedCount, 3);

    const snapshot = await getCostCenterSnapshot(shopDomain);

    assert.ok(snapshot, "Cost center snapshot should exist for imported shop.");
    assert.equal(snapshot.categoryProfiles.length, 3);
    assert.equal(snapshot.costCoverageSummary.categoryCoveredCount, 2);
    assert.equal(snapshot.costCoverageSummary.uncoveredCount, 0);

    console.info(
      JSON.stringify(
        {
          importedCount: result.importedCount,
          templateHeaders: getFallbackRuleImportTemplateCsv().split("\n")[0],
          categoryCoverageSummary: snapshot.costCoverageSummary,
          rules: snapshot.categoryProfiles.map((profile) => ({
            label: profile.displayLabel,
            matchKey: profile.displayValue,
            rate: profile.defaultCostRate,
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
  console.error("[smoke] Fallback rule import failed", error);
  await db.$disconnect();
  process.exit(1);
});
