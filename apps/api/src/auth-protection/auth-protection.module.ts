import { Module } from '@nestjs/common';
import { AuditCoreModule } from '../audit/audit-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountLockoutService } from './account-lockout.service';
import { AuthProtectionAuditService } from './auth-protection-audit.service';
import { BRUTE_FORCE_NOTIFIER, NoopBruteForceNotifier } from './brute-force-notifier';
import { IpBanService } from './ip-ban.service';
import { LockoutPruneService } from './lockout-prune.service';
import { LoginProtectionService } from './login-protection.service';
import { RateLimitConfig } from './rate-limit.config';

/**
 * Brute-force protection layer (Prompt 35): unified rate-limit throttle, persistent account lockout, and
 * per-IP escalation/ban shared by the admin + end-user login paths and the SAML SSO endpoint. Singletons
 * (in-memory throttle/ban state lives on the service instances), so this module is imported, not
 * re-instantiated, by consumers.
 */
@Module({
	imports: [PrismaModule, AuditCoreModule],
	providers: [
		RateLimitConfig,
		AccountLockoutService,
		IpBanService,
		AuthProtectionAuditService,
		LoginProtectionService,
		LockoutPruneService,
		{ provide: BRUTE_FORCE_NOTIFIER, useClass: NoopBruteForceNotifier },
	],
	exports: [
		RateLimitConfig,
		AccountLockoutService,
		LoginProtectionService,
		AuthProtectionAuditService,
		BRUTE_FORCE_NOTIFIER,
	],
})
export class AuthProtectionModule {}
