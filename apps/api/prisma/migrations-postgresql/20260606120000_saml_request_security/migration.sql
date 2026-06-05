-- SAML AuthnRequest signing requirements (Prompt 24 schema/types)
ALTER TABLE "SpConnection" ADD COLUMN "wantAuthnRequestsSigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdpSettings" ADD COLUMN "wantAuthnRequestsSigned" BOOLEAN NOT NULL DEFAULT false;
