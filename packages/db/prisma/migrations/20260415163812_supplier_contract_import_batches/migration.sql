ALTER TYPE "CostImportType" ADD VALUE 'SUPPLIER_CONTRACTS';

ALTER TABLE "SupplierContractProfile"
ADD COLUMN "importedBatchKey" TEXT;

CREATE INDEX "SupplierContractProfile_shopId_importedBatchKey_idx"
ON "SupplierContractProfile"("shopId", "importedBatchKey");
