import { Module } from '@nestjs/common';
import { ApiConnectionsModule } from '../api-connections/api-connections.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';

@Module({
	imports: [IdentityModule, AdminAuthModule, ApiConnectionsModule],
	controllers: [AdminController],
	providers: [AdminStatsService],
})
export class AdminModule {}
