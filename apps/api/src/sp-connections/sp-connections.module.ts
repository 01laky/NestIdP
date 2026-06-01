import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdpMetadataController } from './idp-metadata.controller';
import { SpConnectionTestAcsService } from './sp-connection-test-acs.service';
import { SpConnectionsAuditService } from './sp-connections-audit.service';
import { SpConnectionsController } from './sp-connections.controller';
import { SpConnectionsService } from './sp-connections.service';

@Module({
	imports: [PrismaModule, AdminAuthModule],
	controllers: [SpConnectionsController, IdpMetadataController],
	providers: [SpConnectionsService, SpConnectionsAuditService, SpConnectionTestAcsService],
	exports: [SpConnectionsService],
})
export class SpConnectionsModule {}
