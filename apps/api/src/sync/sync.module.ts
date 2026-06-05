import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentitySyncClientService } from './services/identity-sync-client.service';
import { SyncController } from './controllers/sync.controller';
import { SyncLogService } from './services/sync-log.service';
import { SyncService } from './services/sync.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, EncryptionModule, IdentityModule, AdminAuthModule],
	controllers: [SyncController],
	providers: [SyncService, SyncLogService, IdentitySyncClientService],
	exports: [SyncService],
})
export class SyncModule {}
