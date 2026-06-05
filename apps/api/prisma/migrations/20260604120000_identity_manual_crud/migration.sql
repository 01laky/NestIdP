-- Manual identity CRUD: IdentityOrigin, local directory flag, audit category identity

CREATE TYPE "IdentityOrigin" AS ENUM ('SYNCED', 'MANUAL');

ALTER TYPE "AuditCategory" ADD VALUE 'identity';

ALTER TABLE "ApiConnection" ADD COLUMN "isLocalDirectory" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User" ADD COLUMN "origin" "IdentityOrigin" NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "Group" ADD COLUMN "origin" "IdentityOrigin" NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "Role" ADD COLUMN "origin" "IdentityOrigin" NOT NULL DEFAULT 'SYNCED';
