import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditCoreModule } from '../audit/audit-core.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
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

@Module({
	imports: [PrismaModule, AuditCoreModule, IdentityModule, ConfigModule],
	controllers: [SamlController],
	providers: [
		SamlRequestParserService,
		SamlResponseBuilderService,
		SamlMetadataService,
		SamlPostBindingService,
		IdpSigningService,
		IdpEncryptionService,
		SamlAttributeMapperService,
		SamlSsoService,
		SamlSessionCleanupService,
		SamlAuthAuditService,
	],
	exports: [SamlSsoService, SamlMetadataService, IdpSigningService, IdpEncryptionService],
})
export class SamlModule {}
