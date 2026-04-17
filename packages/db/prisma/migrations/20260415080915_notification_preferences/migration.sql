-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummaryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "alertDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "recipientEmails" JSONB,
    "replyToEmail" TEXT,
    "preferredSendHour" INTEGER NOT NULL DEFAULT 8,
    "timezoneOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_shopId_key" ON "NotificationPreference"("shopId");

-- CreateIndex
CREATE INDEX "NotificationPreference_shopId_preferredSendHour_idx" ON "NotificationPreference"("shopId", "preferredSendHour");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
