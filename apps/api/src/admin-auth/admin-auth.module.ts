import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminCsrfGuard } from './admin-csrf.guard';
import { AdminCsrfService } from './admin-csrf.service';
import { AdminSessionService } from './admin-session.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { PasswordService } from './password.service';

@Module({
	imports: [PrismaModule],
	controllers: [AdminAuthController],
	providers: [
		AdminAuthService,
		AdminSessionService,
		AdminAuthGuard,
		AdminCsrfGuard,
		AdminCsrfService,
		PasswordService,
		LoginRateLimiterService,
	],
	exports: [
		AdminAuthGuard,
		AdminCsrfGuard,
		AdminCsrfService,
		AdminSessionService,
		PasswordService,
		AdminAuthService,
	],
})
export class AdminAuthModule {}
