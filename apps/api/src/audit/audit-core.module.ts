import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditPersistenceService } from './audit-persistence.service';
import { AuditRetentionCleanupService } from './audit-retention-cleanup.service';

@Global()
@Module({
	imports: [PrismaModule],
	providers: [AuditPersistenceService, AuditRetentionCleanupService],
	exports: [AuditPersistenceService],
})
export class AuditCoreModule {}
