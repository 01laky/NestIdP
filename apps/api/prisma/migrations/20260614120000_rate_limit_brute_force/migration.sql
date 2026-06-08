-- CreateTable
CREATE TABLE "LoginLockout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "usernameKey" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastFailedAt" DATETIME,
    "lastLockedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LoginLockout_lockedUntil_idx" ON "LoginLockout"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "LoginLockout_scope_usernameKey_key" ON "LoginLockout"("scope", "usernameKey");
