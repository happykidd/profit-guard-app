export const CATEGORY_MATCH_SCOPES = ["PRODUCT_TYPE", "VENDOR", "TAG"] as const;

export type CategoryMatchScope = (typeof CATEGORY_MATCH_SCOPES)[number];

type CategoryProfileRecord = {
  categoryKey: string;
};

type CategoryProfileMatchInput = {
  productType?: string | null;
  tags?: string[] | null;
  vendor?: string | null;
};

const CATEGORY_MATCH_SCOPE_PREFIX: Record<CategoryMatchScope, string> = {
  PRODUCT_TYPE: "product_type",
  TAG: "tag",
  VENDOR: "vendor",
};

export function normalizeCategoryKey(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeCategoryMatchKey(value: string | null | undefined) {
  return normalizeCategoryKey(value).toLowerCase();
}

export function resolveCategoryMatchScope(value: string | null | undefined): CategoryMatchScope {
  const normalizedValue = normalizeCategoryMatchKey(value).replace(/\s+/g, "_");

  switch (normalizedValue) {
    case "vendor":
      return "VENDOR";
    case "tag":
      return "TAG";
    case "product_type":
    case "producttype":
    default:
      return "PRODUCT_TYPE";
  }
}

export function getCategoryMatchScopeLabel(scope: CategoryMatchScope) {
  switch (scope) {
    case "VENDOR":
      return "Vendor";
    case "TAG":
      return "Tag";
    case "PRODUCT_TYPE":
    default:
      return "Product type";
  }
}

export function buildScopedCategoryMatchKey(scope: CategoryMatchScope, value: string | null | undefined) {
  const normalizedValue = normalizeCategoryMatchKey(value);

  if (!normalizedValue) {
    return "";
  }

  return `${CATEGORY_MATCH_SCOPE_PREFIX[scope]}::${normalizedValue}`;
}

export function encodeCategoryProfileKey(scope: CategoryMatchScope, value: string | null | undefined) {
  const normalizedValue = normalizeCategoryKey(value);

  if (!normalizedValue) {
    return "";
  }

  return `${CATEGORY_MATCH_SCOPE_PREFIX[scope]}::${normalizedValue}`;
}

export function parseCategoryProfileKey(value: string | null | undefined) {
  const normalizedValue = normalizeCategoryKey(value);

  if (!normalizedValue) {
    return {
      displayLabel: getCategoryMatchScopeLabel("PRODUCT_TYPE"),
      key: "",
      normalizedMatchKey: "",
      scope: "PRODUCT_TYPE" as const,
    };
  }

  for (const scope of CATEGORY_MATCH_SCOPES) {
    const prefix = `${CATEGORY_MATCH_SCOPE_PREFIX[scope]}::`;

    if (normalizedValue.toLowerCase().startsWith(prefix)) {
      const rawKey = normalizeCategoryKey(normalizedValue.slice(prefix.length));

      return {
        displayLabel: getCategoryMatchScopeLabel(scope),
        key: rawKey,
        normalizedMatchKey: buildScopedCategoryMatchKey(scope, rawKey),
        scope,
      };
    }
  }

  return {
    displayLabel: getCategoryMatchScopeLabel("PRODUCT_TYPE"),
    key: normalizedValue,
    normalizedMatchKey: buildScopedCategoryMatchKey("PRODUCT_TYPE", normalizedValue),
    scope: "PRODUCT_TYPE" as const,
  };
}

export function findCategoryProfileMatch<T extends CategoryProfileRecord>(
  profiles: T[],
  input: CategoryProfileMatchInput,
) {
  const lookup = new Map<string, { parsed: ReturnType<typeof parseCategoryProfileKey>; profile: T }>();

  for (const profile of profiles) {
    const parsed = parseCategoryProfileKey(profile.categoryKey);

    if (!parsed.normalizedMatchKey) {
      continue;
    }

    lookup.set(parsed.normalizedMatchKey, {
      parsed,
      profile,
    });
  }

  const tagCandidates = Array.from(
    new Set((input.tags ?? []).map((tag) => normalizeCategoryKey(tag)).filter(Boolean)),
  );
  const candidates: Array<{ scope: CategoryMatchScope; value: string | null | undefined }> = [
    {
      scope: "PRODUCT_TYPE",
      value: input.productType,
    },
    {
      scope: "VENDOR",
      value: input.vendor,
    },
    ...tagCandidates.map((tag) => ({
      scope: "TAG" as const,
      value: tag,
    })),
  ];

  for (const candidate of candidates) {
    const normalizedMatchKey = buildScopedCategoryMatchKey(candidate.scope, candidate.value);

    if (!normalizedMatchKey) {
      continue;
    }

    const matched = lookup.get(normalizedMatchKey);

    if (matched) {
      return {
        matchedKey: matched.parsed.key,
        profile: matched.profile,
        scope: matched.parsed.scope,
      };
    }
  }

  return null;
}

export function parseDefaultCostRateInput(rawValue: string) {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return {
      error: "Default cost rate is required.",
      normalizedRate: null,
    };
  }

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return {
      error: "Default cost rate must be greater than 0.",
      normalizedRate: null,
    };
  }

  const normalizedRate = numericValue > 1 ? numericValue / 100 : numericValue;

  if (normalizedRate <= 0 || normalizedRate > 1) {
    return {
      error: "Default cost rate must be between 0 and 100%.",
      normalizedRate: null,
    };
  }

  return {
    error: null,
    normalizedRate: normalizedRate.toFixed(4),
  };
}

export function formatDefaultCostRatePercent(value: string | number | null | undefined) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return "Not available";
  }

  const percentValue = numericValue * 100;
  const formatted = percentValue.toFixed(2).replace(/\.?0+$/, "");

  return `${formatted}%`;
}
