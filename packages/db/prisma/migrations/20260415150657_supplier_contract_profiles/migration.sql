-- CreateTable
CREATE TABLE "SupplierContractProfile" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "productType" TEXT,
    "unitCostAmount" DECIMAL(14,4) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContractProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierContractProfile_shopId_vendorName_idx" ON "SupplierContractProfile"("shopId", "vendorName");

-- CreateIndex
CREATE INDEX "SupplierContractProfile_shopId_productType_idx" ON "SupplierContractProfile"("shopId", "productType");

-- CreateIndex
CREATE INDEX "SupplierContractProfile_shopId_effectiveFrom_idx" ON "SupplierContractProfile"("shopId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "SupplierContractProfile_shopId_effectiveTo_idx" ON "SupplierContractProfile"("shopId", "effectiveTo");

-- AddForeignKey
ALTER TABLE "SupplierContractProfile" ADD CONSTRAINT "SupplierContractProfile_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
