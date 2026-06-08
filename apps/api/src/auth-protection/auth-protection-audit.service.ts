import { Injectable, Logger } from '@nestjs/common';
import { AuditPersistenceService } from '../audit/services/audit-persistence.service';
import type { LoginScope } from './brute-force-notifier';

export type ProtectedSurface = LoginScope | 'sso';

/** Which rate-limit dimension tripped — surfaced in audit metadata, never in the HTTP response. */
export type LimiterKind = 'ip' | 'username';

function categoryFor(surface: ProtectedSurface): 'admin_auth' | 'end_user_auth' | 'saml' {
	if (surface === 'admin') {
		return 'admin_auth';
	}
	if (surface === 'sso') {
		return 'saml';
	}
	return 'end_user_auth';
}

/**
 * Audit + structured-log sink for the brute-force protection layer (Prompt 35). Every lock / limit / ban
 * is persisted as an `AuditEvent` (system actor for automatic events, admin actor for manual unlocks) AND
 * emitted as a structured JSON log line for SIEM ingestion. No secrets — only username/IP/counts/until.
 */
@Injectable()
export class AuthProtectionAuditService {
	private readonly logger = new Logger('AuthProtection');

	constructor(private readonly audit: AuditPersistenceService) {}

	logAccountLocked(
		scope: LoginScope,
		usernameKey: string,
		clientIp: string,
		failedCount: number,
		lockedUntil: Date | null,
	): void {
		const until = lockedUntil?.toISOString() ?? null;
		this.audit.recordSafe({
			category: categoryFor(scope),
			event: `${scope}_login_locked`,
			actorType: 'system',
			actorLabel: usernameKey,
			clientIp,
			metadata: { failedCount, lockedUntil: until },
		});
		this.logger.warn(
			JSON.stringify({ event: 'login_locked', scope, usernameKey, clientIp, failedCount, until }),
		);
	}

	logRateLimited(
		surface: ProtectedSurface,
		clientIp: string,
		limiter: LimiterKind,
		retryAfterMs: number,
		usernameKey?: string,
	): void {
		const event = surface === 'sso' ? 'saml_sso_rate_limited' : `${surface}_login_rate_limited`;
		this.audit.recordSafe({
			category: categoryFor(surface),
			event,
			actorType: 'system',
			actorLabel: usernameKey,
			clientIp,
			metadata: { limiter, retryAfterMs },
		});
		this.logger.warn(
			JSON.stringify({
				event: surface === 'sso' ? 'saml_sso_rate_limited' : 'login_rate_limited',
				surface,
				usernameKey,
				clientIp,
				limiter,
				retryAfterMs,
			}),
		);
	}

	logIpBanned(
		surface: ProtectedSurface,
		clientIp: string,
		count: number,
		bannedUntil: Date | null,
	): void {
		const until = bannedUntil?.toISOString() ?? null;
		this.audit.recordSafe({
			category: categoryFor(surface),
			event: 'login_ip_banned',
			actorType: 'system',
			clientIp,
			metadata: { surface, count, bannedUntil: until },
		});
		this.logger.warn(JSON.stringify({ event: 'login_ip_banned', surface, clientIp, count, until }));
	}

	logAccountUnlocked(
		scope: LoginScope,
		usernameKey: string,
		adminId: string,
		adminUsername: string,
		clientIp: string,
	): void {
		this.audit.recordSafe({
			category: categoryFor(scope),
			event: `${scope}_account_unlocked`,
			actorType: 'admin',
			actorId: adminId,
			actorLabel: adminUsername,
			subjectType: scope,
			subjectId: usernameKey,
			clientIp,
		});
		this.logger.log(
			JSON.stringify({ event: 'account_unlocked', scope, usernameKey, by: adminUsername }),
		);
	}
}
