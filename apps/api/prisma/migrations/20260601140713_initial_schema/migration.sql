-- CreateTable
CREATE TABLE "ApiConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'BEARER',
    "authCredentialsEncrypted" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'NEVER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "apiConnectionId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "passwordHashAlgorithm" TEXT NOT NULL DEFAULT 'bcrypt',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_apiConnectionId_fkey" FOREIGN KEY ("apiConnectionId") REFERENCES "ApiConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "apiConnectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Group_apiConnectionId_fkey" FOREIGN KEY ("apiConnectionId") REFERENCES "ApiConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "apiConnectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Role_apiConnectionId_fkey" FOREIGN KEY ("apiConnectionId") REFERENCES "ApiConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserGroup" (
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "groupId"),
    CONSTRAINT "UserGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "spEntityId" TEXT NOT NULL,
    "acsUrl" TEXT NOT NULL,
    "spCertificate" TEXT,
    "nameIdFormat" TEXT NOT NULL DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    "attributeMapping" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiConnectionId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "usersSynced" INTEGER NOT NULL DEFAULT 0,
    "groupsSynced" INTEGER NOT NULL DEFAULT 0,
    "rolesSynced" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    CONSTRAINT "SyncLog_apiConnectionId_fkey" FOREIGN KEY ("apiConnectionId") REFERENCES "ApiConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SamlSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "samlRequestId" TEXT NOT NULL,
    "relayState" TEXT,
    "spConnectionId" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SamlSession_spConnectionId_fkey" FOREIGN KEY ("spConnectionId") REFERENCES "SpConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SamlSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IdpSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "entityId" TEXT NOT NULL,
    "signingCertPem" TEXT,
    "signingKeyEncrypted" TEXT,
    "nameIdFormat" TEXT NOT NULL DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_apiConnectionId_idx" ON "User"("apiConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_apiConnectionId_externalId_key" ON "User"("apiConnectionId", "externalId");

-- CreateIndex
CREATE INDEX "Group_apiConnectionId_idx" ON "Group"("apiConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_apiConnectionId_externalId_key" ON "Group"("apiConnectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_apiConnectionId_name_key" ON "Group"("apiConnectionId", "name");

-- CreateIndex
CREATE INDEX "Role_apiConnectionId_idx" ON "Role"("apiConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_apiConnectionId_externalId_key" ON "Role"("apiConnectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_apiConnectionId_name_key" ON "Role"("apiConnectionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SpConnection_spEntityId_key" ON "SpConnection"("spEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE INDEX "SyncLog_apiConnectionId_idx" ON "SyncLog"("apiConnectionId");

-- CreateIndex
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SamlSession_samlRequestId_key" ON "SamlSession"("samlRequestId");

-- CreateIndex
CREATE INDEX "SamlSession_expiresAt_idx" ON "SamlSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SamlSession_spConnectionId_idx" ON "SamlSession"("spConnectionId");
