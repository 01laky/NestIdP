import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ApiConnectionsAuditService } from './api-connections-audit.service';
import { ApiConnectionTestService } from './api-connection-test.service';
import { ApiConnectionsController } from './api-connections.controller';
import { ApiConnectionsService } from './api-connections.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, AdminAuthModule, EncryptionModule],
	controllers: [ApiConnectionsController],
	providers: [ApiConnectionsService, ApiConnectionTestService, ApiConnectionsAuditService],
})
export class ApiConnectionsModule {}
