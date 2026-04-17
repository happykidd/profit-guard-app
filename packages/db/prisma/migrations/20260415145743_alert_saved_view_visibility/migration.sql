-- CreateEnum
CREATE TYPE "SavedViewVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- DropIndex
DROP INDEX "AlertSavedView_shopId_name_key";

-- AlterTable
ALTER TABLE "AlertSavedView"
ADD COLUMN "createdByLabel" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "visibility" "SavedViewVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateIndex
CREATE UNIQUE INDEX "AlertSavedView_shopId_visibility_name_key" ON "AlertSavedView"("shopId", "visibility", "name");
