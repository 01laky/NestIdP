-- IdP signing crypto metadata (v1.4.7)
ALTER TABLE "IdpSettings" ADD COLUMN "signingKeyFamily" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "signingSignatureAlgorithmId" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "signingRsaModulusBits" INTEGER;
ALTER TABLE "IdpSettings" ADD COLUMN "signingEcCurve" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningKeyFamily" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningSignatureAlgorithmId" TEXT;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningRsaModulusBits" INTEGER;
ALTER TABLE "IdpSettings" ADD COLUMN "pendingSigningEcCurve" TEXT;

UPDATE "IdpSettings"
SET
	"signingKeyFamily" = 'rsa',
	"signingSignatureAlgorithmId" = 'rsa-sha256',
	"signingRsaModulusBits" = 2048
WHERE "signingCertPem" IS NOT NULL AND "signingKeyEncrypted" IS NOT NULL;
