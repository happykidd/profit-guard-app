import {
  encodeCategoryProfileKey,
  normalizeCategoryKey,
  parseDefaultCostRateInput,
  parseCategoryProfileKey,
  resolveCategoryMatchScope,
  type CategoryMatchScope,
} from "../../../../packages/db/src/category-cost";
import db from "../db.server";

type CategoryCostClient = Pick<typeof db, "categoryCostProfile">;

export async function upsertCategoryCostProfile(args: {
  client?: CategoryCostClient;
  shopId: string;
  matchKey: string;
  matchScope: CategoryMatchScope | string;
  defaultCostRateInput: string;
  importedBatchKey?: string | null;
  notes: string | null;
}) {
  const client = args.client ?? db;
  const matchScope = resolveCategoryMatchScope(args.matchScope);
  const matchKey = normalizeCategoryKey(args.matchKey);

  if (!matchKey) {
    throw new Error(`${matchScope === "PRODUCT_TYPE" ? "Product type" : matchScope === "VENDOR" ? "Vendor" : "Tag"} is required.`);
  }

  const parsedRate = parseDefaultCostRateInput(args.defaultCostRateInput);

  if (parsedRate.error || !parsedRate.normalizedRate) {
    throw new Error(parsedRate.error ?? "Default cost rate is invalid.");
  }

  const categoryKey = encodeCategoryProfileKey(matchScope, matchKey);
  const existingProfiles = await client.categoryCostProfile.findMany({
    where: {
      shopId: args.shopId,
    },
    select: {
      categoryKey: true,
      id: true,
    },
  });

  const existingProfile =
    existingProfiles.find((profile) => {
      const parsed = parseCategoryProfileKey(profile.categoryKey);
      return parsed.scope === matchScope && parsed.key.toLowerCase() === matchKey.toLowerCase();
    }) ?? null;

  if (existingProfile) {
    return client.categoryCostProfile.update({
      where: {
        id: existingProfile.id,
      },
      data: {
        categoryKey,
        defaultCostRate: parsedRate.normalizedRate,
        importedBatchKey: args.importedBatchKey ?? null,
        notes: args.notes?.trim() || null,
      },
    });
  }

  return client.categoryCostProfile.create({
    data: {
      shopId: args.shopId,
      categoryKey,
      defaultCostRate: parsedRate.normalizedRate,
      importedBatchKey: args.importedBatchKey ?? null,
      notes: args.notes?.trim() || null,
    },
  });
}

export async function deleteCategoryCostProfile(args: {
  shopId: string;
  profileId: string;
}) {
  const deleted = await db.categoryCostProfile.deleteMany({
    where: {
      id: args.profileId,
      shopId: args.shopId,
    },
  });

  if (deleted.count === 0) {
    throw new Error("Category cost profile not found.");
  }
}
