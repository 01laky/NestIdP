import { Module } from '@nestjs/common';
import { IdpSettingsModule } from '../idp-settings/idp-settings.module';
import { BackchannelLogoutModule } from '../saml/backchannel-logout.module';
import { SyncModule } from '../sync/sync.module';
import { HealthController } from './controllers/health.controller';
import { HealthService } from './services/health.service';

// Scheduler gauges: these modules export their scheduler services so /health can read tick stats.
// AuditPersistenceService comes from the @Global AuditCoreModule (no import needed).
@Module({
	imports: [SyncModule, IdpSettingsModule, BackchannelLogoutModule],
	controllers: [HealthController],
	providers: [HealthService],
	exports: [HealthService],
})
export class HealthModule {}
