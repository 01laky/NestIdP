-- IdP encryption certificate + SP wantAssertionsEncrypted (v1.5.0)
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionCertPem" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionKeyEncrypted" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionKeyFamily" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionKeyTransportAlgorithmId" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionRsaModulusBits" INTEGER;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionEcCurve" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionCertPem" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionKeyEncrypted" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionKeyFamily" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionKeyTransportAlgorithmId" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionRsaModulusBits" INTEGER;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingEncryptionEcCurve" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "encryptionRotationStartedAt" TIMESTAMP(3);

ALTER TABLE "SpConnection" ADD COLUMN "wantAssertionsEncrypted" BOOLEAN NOT NULL DEFAULT false;
