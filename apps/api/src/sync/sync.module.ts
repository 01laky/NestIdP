import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { IdentitySyncClientService } from './services/identity-sync-client.service';
import { SyncController } from './controllers/sync.controller';
import { SyncScheduleController } from './controllers/sync-schedule.controller';
import { SyncLogService } from './services/sync-log.service';
import { SyncService } from './services/sync.service';
import { SyncSchedulerService } from './services/sync-scheduler.service';
import { SyncScheduleService } from './services/sync-schedule.service';
import { SyncScheduleConfigService } from './services/sync-schedule-config.service';
import { SyncMultiSourceConfig } from './services/sync-multi-source.config';
import { NoopScheduledSyncNotifier, SCHEDULED_SYNC_NOTIFIER } from './scheduled-sync-notifier';
import { OAuthCoreModule } from './oauth-core.module';
import { ProxyCoreModule } from './proxy-core.module';

@Module({
	imports: [
		PrismaModule,
		AuditCoreModule,
		EncryptionModule,
		IdentityModule,
		AdminAuthModule,
		OAuthCoreModule,
		ProxyCoreModule,
	],
	controllers: [SyncController, SyncScheduleController],
	providers: [
		SyncService,
		SyncLogService,
		IdentitySyncClientService,
		SyncScheduleConfigService,
		SyncMultiSourceConfig,
		SyncScheduleService,
		SyncSchedulerService,
		{ provide: SCHEDULED_SYNC_NOTIFIER, useClass: NoopScheduledSyncNotifier },
	],
	exports: [SyncService, SyncScheduleConfigService, SyncMultiSourceConfig],
})
export class SyncModule {}
