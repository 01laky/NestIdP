import { Module } from '@nestjs/common';
import { SAML_SESSION_BIND_PORT } from '@nestidp/shared';
import { AuditCoreModule } from '../audit/audit-core.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SamlModule } from '../saml/saml.module';
import { AuthController } from './controllers/auth.controller';
import { EndUserAuthAuditService } from './services/end-user-auth-audit.service';
import { EndUserAuthGuard } from './guards/end-user-auth.guard';
import { EndUserAuthService } from './services/end-user-auth.service';
import { EndUserLoginRateLimiterService } from './services/end-user-login-rate-limiter.service';
import { EndUserSessionService } from './services/end-user-session.service';
import { SamlSessionBindService } from './services/saml-session-bind.service';

@Module({
	imports: [PrismaModule, AuditCoreModule, IdentityModule, SamlModule],
	controllers: [AuthController],
	providers: [
		EndUserAuthService,
		EndUserSessionService,
		EndUserAuthGuard,
		EndUserLoginRateLimiterService,
		EndUserAuthAuditService,
		SamlSessionBindService,
		{ provide: SAML_SESSION_BIND_PORT, useExisting: SamlSessionBindService },
	],
	exports: [
		EndUserAuthService,
		EndUserSessionService,
		EndUserAuthGuard,
		SamlSessionBindService,
		SAML_SESSION_BIND_PORT,
	],
})
export class AuthModule {}
