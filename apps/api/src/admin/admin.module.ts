import { Module } from '@nestjs/common';
import { ApiConnectionsModule } from '../api-connections/api-connections.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { IdentityAdminModule } from '../identity-admin/identity-admin.module';
import { IdentityModule } from '../identity/identity.module';
import { IdpSettingsModule } from '../idp-settings/idp-settings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SpConnectionsModule } from '../sp-connections/sp-connections.module';
import { SyncModule } from '../sync/sync.module';
import { AdminController } from './controllers/admin.controller';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminStatsService } from './services/admin-stats.service';
import { AdminUsersModule } from '../admin-users/admin-users.module';
import { AuditModule } from '../audit/audit.module';

@Module({
	imports: [
		AuditModule,
		PrismaModule,
		IdentityModule,
		IdentityAdminModule,
		AdminAuthModule,
		ApiConnectionsModule,
		SyncModule,
		SpConnectionsModule,
		IdpSettingsModule,
		AdminUsersModule,
	],
	controllers: [AdminController],
	providers: [AdminStatsService, AdminDashboardService],
})
export class AdminModule {}
