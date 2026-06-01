import { Module } from '@nestjs/common';
import { SAML_SESSION_BIND_PORT } from '@nestidp/shared';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { EndUserAuthAuditService } from './end-user-auth-audit.service';
import { EndUserAuthGuard } from './end-user-auth.guard';
import { EndUserAuthService } from './end-user-auth.service';
import { EndUserLoginRateLimiterService } from './end-user-login-rate-limiter.service';
import { EndUserSessionService } from './end-user-session.service';
import { SamlSessionBindService } from './saml-session-bind.service';

@Module({
	imports: [PrismaModule, IdentityModule],
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
