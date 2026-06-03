import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentitySyncClientService } from './identity-sync-client.service';
import { SyncController } from './sync.controller';
import { SyncLogService } from './sync-log.service';
import { SyncService } from './sync.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, EncryptionModule, IdentityModule, AdminAuthModule],
	controllers: [SyncController],
	providers: [SyncService, SyncLogService, IdentitySyncClientService],
	exports: [SyncService],
})
export class SyncModule {}
