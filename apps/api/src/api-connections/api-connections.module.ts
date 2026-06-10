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
import { IdentitySyncClientService } from '../sync/services/identity-sync-client.service';
import { OAuthCoreModule } from '../sync/oauth-core.module';
import { ProxyCoreModule } from '../sync/proxy-core.module';
import { SamlSessionRegistryModule } from '../saml-sessions/saml-session-registry.module';

@Module({
	imports: [
		PrismaModule,
		AuditCoreModule,
		AdminAuthModule,
		EncryptionModule,
		OAuthCoreModule,
		ProxyCoreModule,
		IdentityModule,
		SamlSessionRegistryModule,
	],
	controllers: [ApiConnectionsController],
	providers: [
		ApiConnectionsService,
		ApiConnectionTestService,
		ApiConnectionsAuditService,
		// Stateless config reader (only needs the global ConfigService) — provided here so the
		// test/preview path shares the sync users-per-run cap (§5.C).
		IdentitySyncClientService,
	],
})
export class ApiConnectionsModule {}
