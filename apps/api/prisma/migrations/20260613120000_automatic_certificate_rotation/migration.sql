-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_IdpSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "entityId" TEXT NOT NULL,
    "signingCertPem" TEXT,
    "signingKeyEncrypted" TEXT,
    "signingKeyFamily" TEXT,
    "signingSignatureAlgorithmId" TEXT,
    "signingRsaModulusBits" INTEGER,
    "signingEcCurve" TEXT,
    "pendingSigningCertPem" TEXT,
    "pendingSigningKeyEncrypted" TEXT,
    "pendingSigningKeyFamily" TEXT,
    "pendingSigningSignatureAlgorithmId" TEXT,
    "pendingSigningRsaModulusBits" INTEGER,
    "pendingSigningEcCurve" TEXT,
    "rotationStartedAt" DATETIME,
    "encryptionCertPem" TEXT,
    "encryptionKeyEncrypted" TEXT,
    "encryptionKeyFamily" TEXT,
    "encryptionKeyTransportAlgorithmId" TEXT,
    "encryptionRsaModulusBits" INTEGER,
    "encryptionEcCurve" TEXT,
    "pendingEncryptionCertPem" TEXT,
    "pendingEncryptionKeyEncrypted" TEXT,
    "pendingEncryptionKeyFamily" TEXT,
    "pendingEncryptionKeyTransportAlgorithmId" TEXT,
    "pendingEncryptionRsaModulusBits" INTEGER,
    "pendingEncryptionEcCurve" TEXT,
    "encryptionRotationStartedAt" DATETIME,
    "autoRotateSigningEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRotateEncryptionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastAutoRotationCheckAt" DATETIME,
    "lastAutoRotationActionAt" DATETIME,
    "signingAutoRotationLastError" TEXT,
    "encryptionAutoRotationLastError" TEXT,
    "signingAutoRotationConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "encryptionAutoRotationConsecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "signingAutoRotationDisabledAt" DATETIME,
    "encryptionAutoRotationDisabledAt" DATETIME,
    "nameIdFormat" TEXT NOT NULL DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    "wantAuthnRequestsSigned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_IdpSettings" ("createdAt", "encryptionCertPem", "encryptionEcCurve", "encryptionKeyEncrypted", "encryptionKeyFamily", "encryptionKeyTransportAlgorithmId", "encryptionRotationStartedAt", "encryptionRsaModulusBits", "entityId", "id", "nameIdFormat", "pendingEncryptionCertPem", "pendingEncryptionEcCurve", "pendingEncryptionKeyEncrypted", "pendingEncryptionKeyFamily", "pendingEncryptionKeyTransportAlgorithmId", "pendingEncryptionRsaModulusBits", "pendingSigningCertPem", "pendingSigningEcCurve", "pendingSigningKeyEncrypted", "pendingSigningKeyFamily", "pendingSigningRsaModulusBits", "pendingSigningSignatureAlgorithmId", "rotationStartedAt", "signingCertPem", "signingEcCurve", "signingKeyEncrypted", "signingKeyFamily", "signingRsaModulusBits", "signingSignatureAlgorithmId", "updatedAt", "wantAuthnRequestsSigned") SELECT "createdAt", "encryptionCertPem", "encryptionEcCurve", "encryptionKeyEncrypted", "encryptionKeyFamily", "encryptionKeyTransportAlgorithmId", "encryptionRotationStartedAt", "encryptionRsaModulusBits", "entityId", "id", "nameIdFormat", "pendingEncryptionCertPem", "pendingEncryptionEcCurve", "pendingEncryptionKeyEncrypted", "pendingEncryptionKeyFamily", "pendingEncryptionKeyTransportAlgorithmId", "pendingEncryptionRsaModulusBits", "pendingSigningCertPem", "pendingSigningEcCurve", "pendingSigningKeyEncrypted", "pendingSigningKeyFamily", "pendingSigningRsaModulusBits", "pendingSigningSignatureAlgorithmId", "rotationStartedAt", "signingCertPem", "signingEcCurve", "signingKeyEncrypted", "signingKeyFamily", "signingRsaModulusBits", "signingSignatureAlgorithmId", "updatedAt", "wantAuthnRequestsSigned" FROM "IdpSettings";
DROP TABLE "IdpSettings";
ALTER TABLE "new_IdpSettings" RENAME TO "IdpSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
