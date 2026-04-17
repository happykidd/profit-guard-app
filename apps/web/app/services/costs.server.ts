import {
  findCategoryProfileMatch,
  parseCategoryProfileKey,
} from "../../../../packages/db/src/category-cost";
import {
  matchSupplierContractProfile,
  normalizeSupplierContractProductType,
  normalizeSupplierContractVendor,
} from "../../../../packages/db/src/supplier-contract";
import db from "../db.server";

export async function getCostCenterSnapshot(shopDomain: string) {
  const shop = await db.shop.findUnique({
    where: {
      shopDomain,
    },
    select: {
      id: true,
      currencyCode: true,
    },
  });

  if (!shop) {
    return null;
  }

  const [variants, activeCosts, categoryProfiles, supplierProfiles, observedProducts] = await Promise.all([
    db.variant.findMany({
      where: {
        shopId: shop.id,
      },
      include: {
        product: {
          select: {
            title: true,
            productType: true,
            tags: true,
            vendor: true,
          },
        },
        costs: {
          where: {
            effectiveTo: null,
          },
          orderBy: {
            effectiveFrom: "desc",
          },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    db.variantCost.findMany({
      where: {
        shopId: shop.id,
        effectiveTo: null,
      },
      include: {
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            product: {
              select: {
                title: true,
                productType: true,
                tags: true,
                vendor: true,
              },
            },
          },
        },
      },
      orderBy: {
        effectiveFrom: "desc",
      },
    }),
    db.categoryCostProfile.findMany({
      where: {
        shopId: shop.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }),
    db.supplierContractProfile.findMany({
      where: {
        shopId: shop.id,
        effectiveTo: null,
      },
      orderBy: [
        {
          vendorName: "asc",
        },
        {
          productType: "asc",
        },
        {
          effectiveFrom: "desc",
        },
      ],
    }),
    db.product.findMany({
      where: {
        shopId: shop.id,
      },
      select: {
        productType: true,
        tags: true,
        vendor: true,
      },
    }),
  ]);

  const missingDirectCostVariants = variants.filter((variant) => variant.costs.length === 0);
  let supplierCoveredCount = 0;
  let categoryCoveredCount = 0;
  const uncoveredCostVariants = missingDirectCostVariants.filter((variant) => {
    const tags = Array.isArray(variant.product.tags)
      ? variant.product.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const supplierMatch = matchSupplierContractProfile(
      supplierProfiles.map((profile) => ({
        vendorName: profile.vendorName,
        productType: profile.productType,
        unitCostAmount: profile.unitCostAmount.toString(),
        currencyCode: profile.currencyCode,
      })),
      {
        productType: variant.product.productType,
        vendor: variant.product.vendor,
      },
    );

    if (supplierMatch) {
      supplierCoveredCount += 1;
      return false;
    }

    const categoryMatch = findCategoryProfileMatch(categoryProfiles, {
      productType: variant.product.productType,
      tags,
      vendor: variant.product.vendor,
    });

    if (categoryMatch) {
      categoryCoveredCount += 1;
      return false;
    }

    return true;
  });
  const observedProductTypes = Array.from(
    new Set(observedProducts.map((product) => product.productType).filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
  const observedVendors = Array.from(
    new Set(observedProducts.map((product) => product.vendor).filter((value): value is string => Boolean(value))),
  ).sort((left, right) => left.localeCompare(right));
  const observedTags = Array.from(
    new Set(
      observedProducts.flatMap((product) =>
        Array.isArray(product.tags) ? product.tags.filter((tag): tag is string => typeof tag === "string") : [],
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return {
    activeCosts: activeCosts.map((cost) => ({
      id: cost.id,
      variantId: cost.variantId,
      sku: cost.sku,
      productTitle: cost.variant?.product.title ?? null,
      productType: cost.variant?.product.productType ?? null,
      tags: Array.isArray(cost.variant?.product.tags)
        ? cost.variant.product.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      variantTitle: cost.variant?.title ?? null,
      vendor: cost.variant?.product.vendor ?? null,
      costAmount: cost.costAmount.toString(),
      currencyCode: cost.currencyCode,
      sourceType: cost.sourceType,
      confidenceLevel: cost.confidenceLevel,
      importedBatchKey: cost.importedBatchKey,
      effectiveFrom: cost.effectiveFrom.toISOString(),
      notes: cost.notes,
    })),
    categoryProfiles: categoryProfiles.map((profile) => {
      const parsed = parseCategoryProfileKey(profile.categoryKey);

      return {
        id: profile.id,
        categoryKey: profile.categoryKey,
        defaultCostRate: profile.defaultCostRate.toString(),
        displayLabel: parsed.displayLabel,
        displayValue: parsed.key,
        importedBatchKey: profile.importedBatchKey,
        matchScope: parsed.scope,
        notes: profile.notes,
        updatedAt: profile.updatedAt.toISOString(),
      };
    }),
    costCoverageSummary: {
      categoryCoveredCount,
      missingDirectCostCount: missingDirectCostVariants.length,
      supplierCoveredCount,
      uncoveredCount: uncoveredCostVariants.length,
    },
    currencyCode: shop.currencyCode ?? "USD",
    missingCostVariants: uncoveredCostVariants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      productType: variant.product.productType,
      tags: Array.isArray(variant.product.tags)
        ? variant.product.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      vendor: variant.product.vendor,
    })),
    observedFallbackValues: {
      productTypes: observedProductTypes,
      tags: observedTags,
      vendors: observedVendors,
    },
    supplierProfiles: supplierProfiles.map((profile) => ({
      id: profile.id,
      vendorName: profile.vendorName,
      productType: profile.productType,
      unitCostAmount: profile.unitCostAmount.toString(),
      currencyCode: profile.currencyCode,
      effectiveFrom: profile.effectiveFrom.toISOString(),
      importedBatchKey: profile.importedBatchKey,
      notes: profile.notes,
      displayLabel: normalizeSupplierContractProductType(profile.productType)
        ? "Vendor + product type contract"
        : "Vendor contract",
      displayValue: normalizeSupplierContractProductType(profile.productType)
        ? `${normalizeSupplierContractVendor(profile.vendorName)} / ${normalizeSupplierContractProductType(profile.productType)}`
        : normalizeSupplierContractVendor(profile.vendorName),
    })),
    shopId: shop.id,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      productTitle: variant.product.title,
      productType: variant.product.productType,
      tags: Array.isArray(variant.product.tags)
        ? variant.product.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      vendor: variant.product.vendor,
      currentCostAmount: variant.costs[0]?.costAmount.toString() ?? null,
      currencyCode: variant.costs[0]?.currencyCode ?? shop.currencyCode ?? "USD",
    })),
  };
}

export async function replaceActiveVariantCost(args: {
  shopId: string;
  variantId: string | null;
  sku: string | null;
  costAmount: string;
  currencyCode: string;
  notes: string | null;
  sourceType: "MANUAL" | "CSV";
  confidenceLevel: "HIGH" | "MEDIUM";
  importedBatchKey?: string | null;
}) {
  const effectiveFrom = new Date();
  const normalizedSku = args.sku?.trim() || null;

  if (!args.variantId && !normalizedSku) {
    throw new Error("Variant or SKU is required");
  }

  await db.$transaction(async (tx) => {
    await tx.variantCost.updateMany({
      where: {
        shopId: args.shopId,
        effectiveTo: null,
        OR: [
          args.variantId
            ? {
                variantId: args.variantId,
              }
            : undefined,
          normalizedSku
            ? {
                sku: normalizedSku,
              }
            : undefined,
        ].filter(Boolean) as Array<{ variantId?: string; sku?: string }>,
      },
      data: {
        effectiveTo: effectiveFrom,
      },
    });

    await tx.variantCost.create({
      data: {
        shopId: args.shopId,
        variantId: args.variantId,
        sku: normalizedSku,
        sourceType: args.sourceType,
        costAmount: args.costAmount,
        currencyCode: args.currencyCode,
        confidenceLevel: args.confidenceLevel,
        effectiveFrom,
        importedBatchKey: args.importedBatchKey ?? null,
        notes: args.notes?.trim() || null,
      },
    });
  });
}

export async function upsertManualVariantCost(args: {
  shopId: string;
  variantId: string | null;
  sku: string | null;
  costAmount: string;
  currencyCode: string;
  notes: string | null;
}) {
  await replaceActiveVariantCost({
    ...args,
    sourceType: "MANUAL",
    confidenceLevel: "HIGH",
    importedBatchKey: null,
  });
}
