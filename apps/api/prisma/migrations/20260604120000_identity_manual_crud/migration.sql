-- Manual identity CRUD: IdentityOrigin, local directory flag, audit category identity

ALTER TABLE "ApiConnection" ADD COLUMN "isLocalDirectory" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "Group" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "Role" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'SYNCED';
