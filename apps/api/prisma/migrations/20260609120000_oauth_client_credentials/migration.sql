-- OAuth 2.0 Client Credentials auth for API connections (v1.10.0)

-- Enum value additions cannot run inside a transaction on PostgreSQL.
ALTER TYPE "AuthType" ADD VALUE IF NOT EXISTS 'OAUTH2_CLIENT_CREDENTIALS';

ALTER TABLE "ApiConnection" ADD COLUMN "oauthTokenUrl" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthClientId" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthClientSecretEncrypted" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthScope" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthAudience" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthClientAuthMethod" TEXT;
ALTER TABLE "ApiConnection" ADD COLUMN "oauthTokenRequestParams" JSONB;
