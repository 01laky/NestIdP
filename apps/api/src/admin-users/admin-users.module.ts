import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminUserCreateRateLimiterService } from './services/admin-user-create-rate-limiter.service';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminUsersService } from './services/admin-users.service';

@Module({
	imports: [PrismaModule, AdminAuthModule],
	controllers: [AdminUsersController],
	providers: [AdminUsersService, AdminUserCreateRateLimiterService],
})
export class AdminUsersModule {}
