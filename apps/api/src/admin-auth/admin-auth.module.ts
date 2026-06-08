import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { AuthProtectionModule } from '../auth-protection/auth-protection.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminAuthService } from './services/admin-auth.service';
import { AdminCsrfGuard } from './guards/admin-csrf.guard';
import { AdminCsrfService } from './services/admin-csrf.service';
import { AdminSessionService } from './services/admin-session.service';
import { PasswordService } from './services/password.service';
import { AdminAuthAuditService } from './services/admin-auth-audit.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, AuthProtectionModule],
	controllers: [AdminAuthController],
	providers: [
		AdminAuthService,
		AdminSessionService,
		AdminAuthGuard,
		AdminCsrfGuard,
		AdminCsrfService,
		PasswordService,
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
