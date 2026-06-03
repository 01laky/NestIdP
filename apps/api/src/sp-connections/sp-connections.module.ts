import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { IdpSettingsModule } from '../idp-settings/idp-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdpMetadataController } from './idp-metadata.controller';
import { SpConnectionTestAcsService } from './sp-connection-test-acs.service';
import { SpConnectionsAuditService } from './sp-connections-audit.service';
import { SpConnectionsController } from './sp-connections.controller';
import { SpConnectionsService } from './sp-connections.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, AdminAuthModule, IdpSettingsModule],
	controllers: [SpConnectionsController, IdpMetadataController],
	providers: [SpConnectionsService, SpConnectionsAuditService, SpConnectionTestAcsService],
	exports: [SpConnectionsService],
})
export class SpConnectionsModule {}
