import {
  normalizeSupplierContractProductType,
  normalizeSupplierContractVendor,
} from "../../../../packages/db/src/supplier-contract";
import db from "../db.server";

type SupplierContractClient = Pick<typeof db, "supplierContractProfile">;

export async function upsertSupplierContractProfile(args: {
  client?: SupplierContractClient;
  effectiveFrom?: Date;
  importedBatchKey?: string | null;
  shopId: string;
  vendorName: string;
  productType?: string | null;
  unitCostAmount: string;
  currencyCode: string;
  notes: string | null;
}) {
  const client = args.client ?? db;
  const vendorName = normalizeSupplierContractVendor(args.vendorName);
  const productType = normalizeSupplierContractProductType(args.productType) || null;
  const unitCostAmount = Number(args.unitCostAmount);
  const currencyCode = args.currencyCode.trim().toUpperCase();

  if (!vendorName) {
    throw new Error("Vendor is required.");
  }

  if (!Number.isFinite(unitCostAmount) || unitCostAmount <= 0) {
    throw new Error("Unit cost amount must be greater than 0.");
  }

  if (!currencyCode || currencyCode.length !== 3) {
    throw new Error("Currency code must be a 3-letter ISO code.");
  }

  const effectiveFrom = args.effectiveFrom ?? new Date();

  await client.supplierContractProfile.updateMany({
    where: {
      shopId: args.shopId,
      vendorName,
      productType,
      effectiveTo: null,
    },
    data: {
      effectiveTo: effectiveFrom,
    },
  });

  await client.supplierContractProfile.create({
    data: {
      shopId: args.shopId,
      vendorName,
      productType,
      unitCostAmount: args.unitCostAmount,
      currencyCode,
      effectiveFrom,
      importedBatchKey: args.importedBatchKey ?? null,
      notes: args.notes?.trim() || null,
    },
  });
}

export async function deleteSupplierContractProfile(args: {
  shopId: string;
  profileId: string;
}) {
  const result = await db.supplierContractProfile.updateMany({
    where: {
      id: args.profileId,
      shopId: args.shopId,
      effectiveTo: null,
    },
    data: {
      effectiveTo: new Date(),
    },
  });

  if (result.count === 0) {
    throw new Error("Supplier contract profile not found.");
  }
}
