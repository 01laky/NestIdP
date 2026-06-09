-- AlterTable
ALTER TABLE "SpConnection" ADD COLUMN "lastBackchannelLogoutAt" DATETIME;
ALTER TABLE "SpConnection" ADD COLUMN "lastBackchannelLogoutStatus" TEXT;
ALTER TABLE "SpConnection" ADD COLUMN "sloSoapUrl" TEXT;

-- CreateTable
CREATE TABLE "SamlBackchannelLogout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ssoSessionId" TEXT NOT NULL,
    "spConnectionId" TEXT NOT NULL,
    "sessionIndex" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameIdFormat" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "lastError" TEXT,
    "lastAttemptAt" DATETIME,
    "nextRetryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SamlBackchannelLogout_spConnectionId_fkey" FOREIGN KEY ("spConnectionId") REFERENCES "SpConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SamlBackchannelLogout_status_nextRetryAt_idx" ON "SamlBackchannelLogout"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SamlBackchannelLogout_ssoSessionId_idx" ON "SamlBackchannelLogout"("ssoSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlBackchannelLogout_ssoSessionId_spConnectionId_key" ON "SamlBackchannelLogout"("ssoSessionId", "spConnectionId");
