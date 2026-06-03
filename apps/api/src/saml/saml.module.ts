import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditCoreModule } from '../audit/audit-core.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdpSigningService } from './idp-signing.service';
import { SamlAttributeMapperService } from './saml-attribute-mapper.service';
import { SamlAuthAuditService } from './saml-auth-audit.service';
import { SamlController } from './saml.controller';
import { SamlMetadataService } from './saml-metadata.service';
import { SamlPostBindingService } from './saml-post-binding.service';
import { SamlRequestParserService } from './saml-request-parser.service';
import { SamlResponseBuilderService } from './saml-response-builder.service';
import { SamlSessionCleanupService } from './saml-session-cleanup.service';
import { SamlSsoService } from './saml-sso.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, IdentityModule, ConfigModule],
	controllers: [SamlController],
	providers: [
		SamlRequestParserService,
		SamlResponseBuilderService,
		SamlMetadataService,
		SamlPostBindingService,
		IdpSigningService,
		SamlAttributeMapperService,
		SamlSsoService,
		SamlSessionCleanupService,
		SamlAuthAuditService,
	],
	exports: [SamlSsoService, SamlMetadataService, IdpSigningService],
})
export class SamlModule {}
