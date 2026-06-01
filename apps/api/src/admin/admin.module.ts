import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';

@Module({
	imports: [IdentityModule, AdminAuthModule],
	controllers: [AdminController],
	providers: [AdminStatsService],
})
export class AdminModule {}
