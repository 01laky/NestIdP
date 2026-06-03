import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminCsrfGuard } from './admin-csrf.guard';
import { AdminCsrfService } from './admin-csrf.service';
import { AdminSessionService } from './admin-session.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { PasswordService } from './password.service';
import { AdminAuthAuditService } from './admin-auth-audit.service';

@Module({
	imports: [PrismaModule, AuditCoreModule],
	controllers: [AdminAuthController],
	providers: [
		AdminAuthService,
		AdminSessionService,
		AdminAuthGuard,
		AdminCsrfGuard,
		AdminCsrfService,
		PasswordService,
		LoginRateLimiterService,
		AdminAuthAuditService,
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
