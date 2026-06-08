-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ApiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'BEARER',
    "authCredentialsEncrypted" TEXT NOT NULL,
    "isLocalDirectory" BOOLEAN NOT NULL DEFAULT false,
    "apiContractConfig" JSONB,
    "oauthTokenUrl" TEXT,
    "oauthClientId" TEXT,
    "oauthClientSecretEncrypted" TEXT,
    "oauthScope" TEXT,
    "oauthAudience" TEXT,
    "oauthClientAuthMethod" TEXT,
    "oauthTokenRequestParams" JSONB,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'NEVER',
    "proxyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "proxyUrl" TEXT,
    "proxyUsername" TEXT,
    "proxyPasswordEncrypted" TEXT,
    "noProxyHosts" TEXT,
    "lastProxyCheckStatus" TEXT,
    "lastProxyCheckAt" DATETIME,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "scheduleTimezone" TEXT,
    "schedulePaused" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDryRun" BOOLEAN NOT NULL DEFAULT false,
    "nextRunAt" DATETIME,
    "lastScheduledRunAt" DATETIME,
    "lastScheduledRunStatus" TEXT,
    "scheduleLastError" TEXT,
    "scheduleConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "scheduleAutoPausedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ApiConnection" ("apiContractConfig", "authCredentialsEncrypted", "authType", "baseUrl", "createdAt", "id", "isLocalDirectory", "lastScheduledRunAt", "lastScheduledRunStatus", "lastSyncAt", "lastSyncStatus", "name", "nextRunAt", "oauthAudience", "oauthClientAuthMethod", "oauthClientId", "oauthClientSecretEncrypted", "oauthScope", "oauthTokenRequestParams", "oauthTokenUrl", "scheduleAutoPausedAt", "scheduleConsecutiveFailures", "scheduleCron", "scheduleDryRun", "scheduleEnabled", "scheduleLastError", "schedulePaused", "scheduleTimezone", "updatedAt") SELECT "apiContractConfig", "authCredentialsEncrypted", "authType", "baseUrl", "createdAt", "id", "isLocalDirectory", "lastScheduledRunAt", "lastScheduledRunStatus", "lastSyncAt", "lastSyncStatus", "name", "nextRunAt", "oauthAudience", "oauthClientAuthMethod", "oauthClientId", "oauthClientSecretEncrypted", "oauthScope", "oauthTokenRequestParams", "oauthTokenUrl", "scheduleAutoPausedAt", "scheduleConsecutiveFailures", "scheduleCron", "scheduleDryRun", "scheduleEnabled", "scheduleLastError", "schedulePaused", "scheduleTimezone", "updatedAt" FROM "ApiConnection";
DROP TABLE "ApiConnection";
ALTER TABLE "new_ApiConnection" RENAME TO "ApiConnection";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
