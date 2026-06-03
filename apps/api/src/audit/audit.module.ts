import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditController } from './audit.controller';
import { AuditCoreModule } from './audit-core.module';
import { AuditQueryService } from './audit-query.service';

@Module({
	imports: [AuditCoreModule, AdminAuthModule],
	controllers: [AuditController],
	providers: [AuditQueryService],
})
export class AuditModule {}
