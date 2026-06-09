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
    "includeInSyncAll" BOOLEAN NOT NULL DEFAULT true,
    "usernameCollisionPolicy" TEXT,
    "lastCollisionCount" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_ApiConnection" ("apiContractConfig", "authCredentialsEncrypted", "authType", "baseUrl", "createdAt", "id", "isLocalDirectory", "lastProxyCheckAt", "lastProxyCheckStatus", "lastScheduledRunAt", "lastScheduledRunStatus", "lastSyncAt", "lastSyncStatus", "name", "nextRunAt", "noProxyHosts", "oauthAudience", "oauthClientAuthMethod", "oauthClientId", "oauthClientSecretEncrypted", "oauthScope", "oauthTokenRequestParams", "oauthTokenUrl", "proxyEnabled", "proxyPasswordEncrypted", "proxyUrl", "proxyUsername", "scheduleAutoPausedAt", "scheduleConsecutiveFailures", "scheduleCron", "scheduleDryRun", "scheduleEnabled", "scheduleLastError", "schedulePaused", "scheduleTimezone", "updatedAt") SELECT "apiContractConfig", "authCredentialsEncrypted", "authType", "baseUrl", "createdAt", "id", "isLocalDirectory", "lastProxyCheckAt", "lastProxyCheckStatus", "lastScheduledRunAt", "lastScheduledRunStatus", "lastSyncAt", "lastSyncStatus", "name", "nextRunAt", "noProxyHosts", "oauthAudience", "oauthClientAuthMethod", "oauthClientId", "oauthClientSecretEncrypted", "oauthScope", "oauthTokenRequestParams", "oauthTokenUrl", "proxyEnabled", "proxyPasswordEncrypted", "proxyUrl", "proxyUsername", "scheduleAutoPausedAt", "scheduleConsecutiveFailures", "scheduleCron", "scheduleDryRun", "scheduleEnabled", "scheduleLastError", "schedulePaused", "scheduleTimezone", "updatedAt" FROM "ApiConnection";
DROP TABLE "ApiConnection";
ALTER TABLE "new_ApiConnection" RENAME TO "ApiConnection";
CREATE TABLE "new_SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiConnectionId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "usersSynced" INTEGER NOT NULL DEFAULT 0,
    "groupsSynced" INTEGER NOT NULL DEFAULT 0,
    "rolesSynced" INTEGER NOT NULL DEFAULT 0,
    "usersSkippedCollision" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "triggerSource" TEXT,
    CONSTRAINT "SyncLog_apiConnectionId_fkey" FOREIGN KEY ("apiConnectionId") REFERENCES "ApiConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SyncLog" ("apiConnectionId", "errors", "finishedAt", "groupsSynced", "id", "rolesSynced", "startedAt", "status", "triggerSource", "usersSynced") SELECT "apiConnectionId", "errors", "finishedAt", "groupsSynced", "id", "rolesSynced", "startedAt", "status", "triggerSource", "usersSynced" FROM "SyncLog";
DROP TABLE "SyncLog";
ALTER TABLE "new_SyncLog" RENAME TO "SyncLog";
CREATE INDEX "SyncLog_apiConnectionId_idx" ON "SyncLog"("apiConnectionId");
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");
CREATE INDEX "SyncLog_triggerSource_idx" ON "SyncLog"("triggerSource");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
