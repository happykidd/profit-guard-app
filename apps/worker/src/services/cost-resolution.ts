import { findCategoryProfileMatch, type CategoryMatchScope } from "../../../../packages/db/src/category-cost";
import { matchSupplierContractProfile } from "../../../../packages/db/src/supplier-contract";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CostCandidate = {
  variantId: string | null;
  sku: string | null;
  costAmount: string;
};

export type CategoryCostCandidate = {
  categoryKey: string;
  defaultCostRate: string;
};

export type SupplierContractCandidate = {
  vendorName: string;
  productType: string | null;
  unitCostAmount: string;
  currencyCode?: string | null;
};

export type ResolvedLineItemCost = {
  amount: number;
  source:
    | "VARIANT"
    | "SKU"
    | "SUPPLIER_CONTRACT_VENDOR_PRODUCT_TYPE"
    | "SUPPLIER_CONTRACT_VENDOR"
    | "CATEGORY_DEFAULT_PRODUCT_TYPE"
    | "CATEGORY_DEFAULT_VENDOR"
    | "CATEGORY_DEFAULT_TAG";
};

function toCategoryDefaultSource(scope: CategoryMatchScope) {
  switch (scope) {
    case "VENDOR":
      return "CATEGORY_DEFAULT_VENDOR" as const;
    case "TAG":
      return "CATEGORY_DEFAULT_TAG" as const;
    case "PRODUCT_TYPE":
    default:
      return "CATEGORY_DEFAULT_PRODUCT_TYPE" as const;
  }
}

function toSupplierContractSource(scope: "VENDOR" | "VENDOR_PRODUCT_TYPE") {
  return scope === "VENDOR_PRODUCT_TYPE"
    ? ("SUPPLIER_CONTRACT_VENDOR_PRODUCT_TYPE" as const)
    : ("SUPPLIER_CONTRACT_VENDOR" as const);
}

export function resolveLineItemCost(args: {
  candidates: CostCandidate[];
  supplierContracts: SupplierContractCandidate[];
  categoryProfiles: CategoryCostCandidate[];
  localVariantId: string | null;
  sku: string | null;
  productType: string | null;
  tags?: string[] | null;
  vendor: string | null;
  quantity: number;
  lineSubtotalAmount: number;
  lineDiscountAmount: number;
}) {
  const directCostMatch =
    args.candidates.find((candidate) => candidate.variantId === args.localVariantId) ??
    args.candidates.find((candidate) => candidate.sku && args.sku && candidate.sku === args.sku) ??
    null;

  if (directCostMatch) {
    return {
      amount: roundMoney(Number(directCostMatch.costAmount) * args.quantity),
      source:
        directCostMatch.variantId === args.localVariantId
          ? ("VARIANT" as const)
          : ("SKU" as const),
      } satisfies ResolvedLineItemCost;
  }

  const supplierContractMatch = matchSupplierContractProfile(args.supplierContracts, {
    productType: args.productType,
    vendor: args.vendor,
  });

  if (supplierContractMatch) {
    return {
      amount: roundMoney(Number(supplierContractMatch.profile.unitCostAmount) * args.quantity),
      source: toSupplierContractSource(supplierContractMatch.scope),
    } satisfies ResolvedLineItemCost;
  }

  const categoryProfileMatch = findCategoryProfileMatch(args.categoryProfiles, {
    productType: args.productType,
    tags: args.tags,
    vendor: args.vendor,
  });

  if (!categoryProfileMatch) {
    return null;
  }

  const netSalesAmount = Math.max(args.lineSubtotalAmount - args.lineDiscountAmount, 0);

  return {
    amount: roundMoney(netSalesAmount * Number(categoryProfileMatch.profile.defaultCostRate)),
    source: toCategoryDefaultSource(categoryProfileMatch.scope),
  } satisfies ResolvedLineItemCost;
}
