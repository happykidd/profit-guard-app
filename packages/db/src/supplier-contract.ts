export const SUPPLIER_CONTRACT_SCOPES = ["VENDOR", "VENDOR_PRODUCT_TYPE"] as const;

export type SupplierContractScope = (typeof SUPPLIER_CONTRACT_SCOPES)[number];

export type SupplierContractMatchCandidate = {
  vendorName: string;
  productType: string | null;
  unitCostAmount: string;
  currencyCode?: string | null;
};

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSupplierContractVendor(value?: string | null) {
  return value ? normalizeWhitespace(value) : "";
}

export function normalizeSupplierContractProductType(value?: string | null) {
  return value ? normalizeWhitespace(value) : "";
}

export function matchSupplierContractProfile(
  profiles: SupplierContractMatchCandidate[],
  args: {
    vendor: string | null;
    productType: string | null;
  },
) {
  const normalizedVendor = normalizeSupplierContractVendor(args.vendor);

  if (!normalizedVendor) {
    return null;
  }

  const normalizedProductType = normalizeSupplierContractProductType(args.productType);
  const exactProductTypeMatch = normalizedProductType
    ? profiles.find((profile) => {
        return (
          normalizeSupplierContractVendor(profile.vendorName).toLowerCase() === normalizedVendor.toLowerCase() &&
          normalizeSupplierContractProductType(profile.productType).toLowerCase() === normalizedProductType.toLowerCase()
        );
      }) ?? null
    : null;

  if (exactProductTypeMatch) {
    return {
      profile: exactProductTypeMatch,
      scope: "VENDOR_PRODUCT_TYPE" as const,
    };
  }

  const vendorOnlyMatch =
    profiles.find((profile) => {
      return (
        normalizeSupplierContractVendor(profile.vendorName).toLowerCase() === normalizedVendor.toLowerCase() &&
        !normalizeSupplierContractProductType(profile.productType)
      );
    }) ?? null;

  if (!vendorOnlyMatch) {
    return null;
  }

  return {
    profile: vendorOnlyMatch,
    scope: "VENDOR" as const,
  };
}
