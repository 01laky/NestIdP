-- SAML Single Logout: SP-initiated SLO + admin session termination (v1.8.0)

-- SpConnection: SLO endpoint + explicit signing policy
ALTER TABLE "SpConnection" ADD COLUMN "sloUrl" TEXT;
ALTER TABLE "SpConnection" ADD COLUMN "wantLogoutRequestsSigned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SamlSsoSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "loginIp" TEXT,
    "userAgent" TEXT,
    "lastSeenIp" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "terminatedAt" DATETIME,
    "terminatedReason" TEXT,
    "terminatedByAdminId" TEXT,
    CONSTRAINT "SamlSsoSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SamlSpParticipation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ssoSessionId" TEXT NOT NULL,
    "spConnectionId" TEXT NOT NULL,
    "sessionIndex" TEXT NOT NULL,
    "nameId" TEXT NOT NULL,
    "nameIdFormat" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SamlSpParticipation_ssoSessionId_fkey" FOREIGN KEY ("ssoSessionId") REFERENCES "SamlSsoSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SamlSpParticipation_spConnectionId_fkey" FOREIGN KEY ("spConnectionId") REFERENCES "SpConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SamlLogoutRequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "spConnectionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SamlSsoSession_status_expiresAt_idx" ON "SamlSsoSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SamlSsoSession_userId_idx" ON "SamlSsoSession"("userId");

-- CreateIndex
CREATE INDEX "SamlSpParticipation_spConnectionId_sessionIndex_idx" ON "SamlSpParticipation"("spConnectionId", "sessionIndex");

-- CreateIndex
CREATE INDEX "SamlSpParticipation_ssoSessionId_idx" ON "SamlSpParticipation"("ssoSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlLogoutRequestLog_requestId_key" ON "SamlLogoutRequestLog"("requestId");

-- CreateIndex
CREATE INDEX "SamlLogoutRequestLog_createdAt_idx" ON "SamlLogoutRequestLog"("createdAt");
