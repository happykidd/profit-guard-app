import prisma from "../../../../packages/db/src/client";
import { upsertCategoryCostProfile } from "../services/category-costs.server";
import { getCostCenterSnapshot } from "../services/costs.server";
import { deleteSupplierContractProfile, upsertSupplierContractProfile } from "../services/supplier-contracts.server";
import { resolveLineItemCost } from "../../../worker/src/services/cost-resolution";

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const shopDomain = `supplier-contract-${Date.now()}.myshopify.com`;
  let createdShopId: string | null = null;

  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain,
        shopName: "Profit Guard Supplier Contract Smoke Shop",
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
        title: "Supplier Contract Tee",
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
        sku: "SUPPLIER-SMOKE-001",
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
      notes: "Vendor-wide annual agreement",
    });

    await upsertSupplierContractProfile({
      shopId: shop.id,
      vendorName: "Profit Guard",
      productType: "Apparel",
      unitCostAmount: "7.25",
      currencyCode: "USD",
      notes: "Apparel-specific landed contract",
    });

    await upsertCategoryCostProfile({
      shopId: shop.id,
      matchKey: "Apparel",
      matchScope: "PRODUCT_TYPE",
      defaultCostRateInput: "40",
      notes: "Fallback only",
    });

    const snapshot = await getCostCenterSnapshot(shopDomain);
    assertCondition(snapshot, "Expected cost center snapshot");
    assertCondition(snapshot.supplierProfiles.length === 2, "Expected two active supplier contract profiles");
    assertCondition(snapshot.costCoverageSummary.missingDirectCostCount === 1, "Expected one variant without direct cost");
    assertCondition(snapshot.costCoverageSummary.supplierCoveredCount === 1, "Expected supplier contract coverage");
    assertCondition(snapshot.costCoverageSummary.uncoveredCount === 0, "Expected no uncovered variants");

    const exactResolved = resolveLineItemCost({
      candidates: [],
      supplierContracts: snapshot.supplierProfiles.map((profile) => ({
        vendorName: profile.vendorName,
        productType: profile.productType,
        unitCostAmount: profile.unitCostAmount,
        currencyCode: profile.currencyCode,
      })),
      categoryProfiles: snapshot.categoryProfiles.map((profile) => ({
        categoryKey: profile.categoryKey,
        defaultCostRate: profile.defaultCostRate,
      })),
      localVariantId: variant.id,
      sku: variant.sku,
      productType: "Apparel",
      vendor: "Profit Guard",
      tags: ["Core"],
      quantity: 2,
      lineSubtotalAmount: 40,
      lineDiscountAmount: 0,
    });
    assertCondition(exactResolved?.source === "SUPPLIER_CONTRACT_VENDOR_PRODUCT_TYPE", "Expected exact supplier contract match");
    assertCondition(exactResolved.amount === 14.5, "Expected apparel supplier contract unit cost to apply");

    const apparelContract = snapshot.supplierProfiles.find((profile) => profile.productType === "Apparel");
    assertCondition(apparelContract, "Expected apparel contract profile");
    await deleteSupplierContractProfile({
      shopId: shop.id,
      profileId: apparelContract.id,
    });

    const fallbackSnapshot = await getCostCenterSnapshot(shopDomain);
    assertCondition(fallbackSnapshot, "Expected snapshot after retiring supplier contract");
    assertCondition(fallbackSnapshot.supplierProfiles.length === 1, "Expected only vendor-wide contract to remain active");

    const vendorResolved = resolveLineItemCost({
      candidates: [],
      supplierContracts: fallbackSnapshot.supplierProfiles.map((profile) => ({
        vendorName: profile.vendorName,
        productType: profile.productType,
        unitCostAmount: profile.unitCostAmount,
        currencyCode: profile.currencyCode,
      })),
      categoryProfiles: fallbackSnapshot.categoryProfiles.map((profile) => ({
        categoryKey: profile.categoryKey,
        defaultCostRate: profile.defaultCostRate,
      })),
      localVariantId: variant.id,
      sku: variant.sku,
      productType: "Apparel",
      vendor: "Profit Guard",
      tags: ["Core"],
      quantity: 2,
      lineSubtotalAmount: 40,
      lineDiscountAmount: 0,
    });
    assertCondition(vendorResolved?.source === "SUPPLIER_CONTRACT_VENDOR", "Expected vendor-wide supplier contract fallback");
    assertCondition(vendorResolved.amount === 16, "Expected vendor-wide supplier contract amount to apply");

    console.info(
      JSON.stringify(
        {
          snapshot: {
            supplierCoveredCount: snapshot.costCoverageSummary.supplierCoveredCount,
            categoryCoveredCount: snapshot.costCoverageSummary.categoryCoveredCount,
            uncoveredCount: snapshot.costCoverageSummary.uncoveredCount,
          },
          activeSupplierProfiles: snapshot.supplierProfiles.map((profile) => ({
            displayValue: profile.displayValue,
            unitCostAmount: profile.unitCostAmount,
          })),
          exactResolved,
          vendorResolved,
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
  console.error("[smoke] Supplier contracts failed", error);
  await prisma.$disconnect();
  process.exit(1);
});
