import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AuthProtectionModule } from '../auth-protection/auth-protection.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { SamlSessionRegistryModule } from '../saml-sessions/saml-session-registry.module';
import { IdpEncryptionKeyService } from './services/idp-encryption-key.service';
import { IdpEncryptionService } from './services/idp-encryption.service';
import { IdpSigningService } from './services/idp-signing.service';
import { SamlAttributeMapperService } from './services/saml-attribute-mapper.service';
import { SamlAuthAuditService } from './services/saml-auth-audit.service';
import { SamlController } from './controllers/saml.controller';
import { SamlMetadataService } from './services/saml-metadata.service';
import { SamlPostBindingService } from './services/saml-post-binding.service';
import { SamlRequestParserService } from './services/saml-request-parser.service';
import { SamlResponseBuilderService } from './services/saml-response-builder.service';
import { SamlSessionCleanupService } from './services/saml-session-cleanup.service';
import { SamlSsoService } from './services/saml-sso.service';
import { SamlLogoutService } from './services/saml-logout.service';
import { SamlLogoutResponseBuilderService } from './services/saml-logout-response-builder.service';
import { SamlSloRateLimiterService } from './services/saml-slo-rate-limiter.service';

@Module({
	imports: [
		PrismaModule,
		AuditCoreModule,
		AuthProtectionModule,
		IdentityModule,
		ConfigModule,
		EncryptionModule,
		SamlSessionRegistryModule,
	],
	controllers: [SamlController],
	providers: [
		SamlRequestParserService,
		SamlResponseBuilderService,
		SamlMetadataService,
		SamlPostBindingService,
		IdpSigningService,
		IdpEncryptionService,
		IdpEncryptionKeyService,
		SamlAttributeMapperService,
		SamlSsoService,
		SamlLogoutService,
		SamlLogoutResponseBuilderService,
		SamlSloRateLimiterService,
		SamlSessionCleanupService,
		SamlAuthAuditService,
	],
	exports: [SamlSsoService, SamlMetadataService, IdpSigningService, IdpEncryptionService],
})
export class SamlModule {}
