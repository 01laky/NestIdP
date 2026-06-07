import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiConnectionsAuditService } from './services/api-connections-audit.service';
import { ApiConnectionTestService } from './services/api-connection-test.service';
import { ApiConnectionsController } from './controllers/api-connections.controller';
import { ApiConnectionsService } from './services/api-connections.service';
import { OAuthCoreModule } from '../sync/oauth-core.module';

@Module({
	imports: [
		PrismaModule,
		AuditCoreModule,
		AdminAuthModule,
		EncryptionModule,
		OAuthCoreModule,
		IdentityModule,
	],
	controllers: [ApiConnectionsController],
	providers: [ApiConnectionsService, ApiConnectionTestService, ApiConnectionsAuditService],
})
export class ApiConnectionsModule {}
