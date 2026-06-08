import { Logger } from '@nestjs/common';

export const BRUTE_FORCE_NOTIFIER = Symbol('BRUTE_FORCE_NOTIFIER');

/** Which login surface an event relates to. `end_user` and `admin` are the lockout scopes. */
export type LoginScope = 'admin' | 'end_user';

/** Non-secret payload for a brute-force notification (never carries a password, hash, or token). */
export interface BruteForceNotification {
	scope: LoginScope;
	/** The attempted login identifier (already shown in admin), when relevant. */
	usernameKey?: string;
	clientIp?: string;
	/** Consecutive-failure count (lock events) or distinct-trip count (ban events). */
	count?: number;
	/** ISO timestamp the lock/ban lifts at. */
	until?: string | null;
}

/**
 * Hook invoked by the brute-force protection layer (Prompt 35) when an account is locked, an IP is
 * banned, or an account is unlocked. The default implementation is a no-op structured logger; a
 * deployment can provide its own (email / Slack / webhook) without touching the login paths. Mirrors
 * {@link CertRotationNotifier} / {@link ScheduledSyncNotifier}.
 */
export interface BruteForceNotifier {
	onAccountLocked(n: BruteForceNotification): Promise<void> | void;
	onIpBanned(n: BruteForceNotification): Promise<void> | void;
	onAccountUnlocked(n: BruteForceNotification): Promise<void> | void;
}

export class NoopBruteForceNotifier implements BruteForceNotifier {
	private readonly logger = new Logger('BruteForceNotifier');

	onAccountLocked(n: BruteForceNotification): void {
		this.logger.warn(JSON.stringify({ event: 'account_locked', ...n }));
	}
	onIpBanned(n: BruteForceNotification): void {
		this.logger.warn(JSON.stringify({ event: 'ip_banned', ...n }));
	}
	onAccountUnlocked(n: BruteForceNotification): void {
		this.logger.log(JSON.stringify({ event: 'account_unlocked', ...n }));
	}
}
