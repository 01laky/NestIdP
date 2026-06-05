import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditPersistenceService } from './services/audit-persistence.service';
import { AuditRetentionCleanupService } from './services/audit-retention-cleanup.service';

@Global()
@Module({
	imports: [PrismaModule],
	providers: [AuditPersistenceService, AuditRetentionCleanupService],
	exports: [AuditPersistenceService],
})
export class AuditCoreModule {}
