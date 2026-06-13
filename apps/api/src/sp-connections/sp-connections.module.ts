import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { IdpSettingsModule } from '../idp-settings/idp-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdpMetadataController } from './controllers/idp-metadata.controller';
import { SpConnectionProbeSigningService } from './services/sp-connection-probe-signing.service';
import { SpConnectionTestAcsService } from './services/sp-connection-test-acs.service';
import { SpConnectionTestSsoUrlService } from './services/sp-connection-test-sso-url.service';
import { SpConnectionsAuditService } from './services/sp-connections-audit.service';
import { SpConnectionsController } from './controllers/sp-connections.controller';
import { SpConnectionsService } from './services/sp-connections.service';
import { SpMetadataFetchConfig } from './sp-metadata-fetch.config';

@Module({
	imports: [PrismaModule, AuditCoreModule, AdminAuthModule, IdpSettingsModule],
	controllers: [SpConnectionsController, IdpMetadataController],
	providers: [
		SpConnectionsService,
		SpConnectionsAuditService,
		SpConnectionTestAcsService,
		SpConnectionTestSsoUrlService,
		SpConnectionProbeSigningService,
		SpMetadataFetchConfig,
	],
	exports: [SpConnectionsService],
})
export class SpConnectionsModule {}
