import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';

@Module({
	imports: [IdentityModule],
	controllers: [AdminController],
	providers: [AdminStatsService],
})
export class AdminModule {}
