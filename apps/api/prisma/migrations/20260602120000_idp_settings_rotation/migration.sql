-- AlterTable
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningCertPem" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningKeyEncrypted" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "rotationStartedAt" DATETIME;
