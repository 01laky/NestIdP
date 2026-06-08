import { Injectable } from '@nestjs/common';
import type { AccountLockoutStatusDto } from '@nestidp/shared';
import { PrismaService } from '../prisma/services/prisma.service';
import type { LoginScope } from './brute-force-notifier';
import { RateLimitConfig } from './rate-limit.config';

/** Convert internal lockout status to the non-secret public DTO shape. */
export function toAccountLockoutStatusDto(s: LockoutStatus): AccountLockoutStatusDto {
	return {
		locked: s.locked,
		lockedUntil: s.lockedUntil?.toISOString() ?? null,
		failedCount: s.failedCount,
		lastFailedAt: s.lastFailedAt?.toISOString() ?? null,
	};
}

export interface LockoutCheck {
	locked: boolean;
	lockedUntil: Date | null;
	retryAfterMs: number;
}

export interface LockoutFailureResult {
	lockedNow: boolean;
	failedCount: number;
	lockedUntil: Date | null;
}

export interface LockoutStatus {
	locked: boolean;
	lockedUntil: Date | null;
	failedCount: number;
	lastFailedAt: Date | null;
}

/**
 * Persistent per-account brute-force lockout (Prompt 35), backed by the `LoginLockout` table so state
 * survives restarts and is shared across the (single) instance. Time-bounded only — `lockedUntil` always
 * expires, so an account (incl. the last admin) can never be permanently locked out. The operator can
 * also unlock early. Disabled per-scope when the threshold is `0`.
 */
@Injectable()
export class AccountLockoutService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly config: RateLimitConfig,
	) {}

	/** Read-only lock check, run BEFORE password verification. No mutation. */
	async check(
		scope: LoginScope,
		usernameKey: string,
		now: Date = new Date(),
	): Promise<LockoutCheck> {
		if (this.config.lockoutThreshold(scope) === 0) {
			return { locked: false, lockedUntil: null, retryAfterMs: 0 };
		}
		const row = await this.prisma.loginLockout.findUnique({
			where: { scope_usernameKey: { scope, usernameKey } },
		});
		if (!row?.lockedUntil) {
			return { locked: false, lockedUntil: null, retryAfterMs: 0 };
		}
		const remaining = row.lockedUntil.getTime() - now.getTime();
		if (remaining > 0) {
			return { locked: true, lockedUntil: row.lockedUntil, retryAfterMs: remaining };
		}
		return { locked: false, lockedUntil: null, retryAfterMs: 0 };
	}

	/** Record a failed attempt; lock once the consecutive-failure count crosses the threshold. */
	async recordFailure(
		scope: LoginScope,
		usernameKey: string,
		now: Date = new Date(),
	): Promise<LockoutFailureResult> {
		const threshold = this.config.lockoutThreshold(scope);
		if (threshold === 0) {
			return { lockedNow: false, failedCount: 0, lockedUntil: null };
		}
		const existing = await this.prisma.loginLockout.findUnique({
			where: { scope_usernameKey: { scope, usernameKey } },
		});
		const failedCount = (existing?.failedCount ?? 0) + 1;
		let lockedUntil = existing?.lockedUntil ?? null;
		let lockedNow = false;
		if (failedCount >= threshold) {
			const over = failedCount - threshold;
			const base = this.config.lockoutBaseMs(scope);
			const backoff = Math.min(this.config.lockoutMaxMs(scope), base * 2 ** over);
			lockedUntil = new Date(now.getTime() + backoff);
			lockedNow = true;
		}
		await this.prisma.loginLockout.upsert({
			where: { scope_usernameKey: { scope, usernameKey } },
			create: {
				scope,
				usernameKey,
				failedCount,
				lockedUntil,
				lastFailedAt: now,
				lastLockedAt: lockedNow ? now : null,
			},
			update: {
				failedCount,
				lockedUntil,
				lastFailedAt: now,
				...(lockedNow ? { lastLockedAt: now } : {}),
			},
		});
		return { lockedNow, failedCount, lockedUntil };
	}

	/** Clear the account on a successful login (or credential rotation). Best-effort, never throws. */
	async recordSuccess(scope: LoginScope, usernameKey: string): Promise<void> {
		await this.prisma.loginLockout
			.deleteMany({ where: { scope, usernameKey } })
			.catch(() => undefined);
	}

	/** Operator unlock — clears the lockout row. Returns whether a row was actually cleared. */
	async unlock(scope: LoginScope, usernameKey: string): Promise<boolean> {
		const result = await this.prisma.loginLockout.deleteMany({ where: { scope, usernameKey } });
		return result.count > 0;
	}

	/** Non-secret status for one account (for the admin DTO). */
	async getStatus(
		scope: LoginScope,
		usernameKey: string,
		now: Date = new Date(),
	): Promise<LockoutStatus> {
		const row = await this.prisma.loginLockout.findUnique({
			where: { scope_usernameKey: { scope, usernameKey } },
		});
		return this.toStatus(row, now);
	}

	/** Batch status lookup to avoid N+1 in list views. */
	async getStatusMany(
		scope: LoginScope,
		usernameKeys: string[],
		now: Date = new Date(),
	): Promise<Map<string, LockoutStatus>> {
		const out = new Map<string, LockoutStatus>();
		if (usernameKeys.length === 0) {
			return out;
		}
		const rows = await this.prisma.loginLockout.findMany({
			where: { scope, usernameKey: { in: usernameKeys } },
		});
		const byKey = new Map(rows.map((r) => [r.usernameKey, r]));
		for (const key of usernameKeys) {
			out.set(key, this.toStatus(byKey.get(key) ?? null, now));
		}
		return out;
	}

	/** Count of accounts currently locked in a scope (for the dashboard security signal). */
	async countLocked(scope: LoginScope, now: Date = new Date()): Promise<number> {
		return this.prisma.loginLockout.count({ where: { scope, lockedUntil: { gt: now } } });
	}

	/** Delete long-stale rows (expired beyond the escalation-memory window). Returns rows removed. */
	async prune(now: Date = new Date()): Promise<number> {
		// Keep escalation memory for the max lock duration after expiry so a quick re-attempt still
		// escalates; only delete rows older than that (or never-locked rows past the same horizon).
		const horizonMs = Math.max(
			this.config.lockoutMaxMs('admin'),
			this.config.lockoutMaxMs('end_user'),
		);
		const cutoff = new Date(now.getTime() - horizonMs);
		const result = await this.prisma.loginLockout.deleteMany({
			where: {
				OR: [
					{ lockedUntil: { not: null, lt: cutoff } },
					{ lockedUntil: null, lastFailedAt: { lt: cutoff } },
				],
			},
		});
		return result.count;
	}

	private toStatus(
		row: {
			failedCount: number;
			lockedUntil: Date | null;
			lastFailedAt: Date | null;
		} | null,
		now: Date,
	): LockoutStatus {
		const locked = Boolean(row?.lockedUntil && row.lockedUntil.getTime() > now.getTime());
		return {
			locked,
			lockedUntil: locked ? (row?.lockedUntil ?? null) : null,
			failedCount: row?.failedCount ?? 0,
			lastFailedAt: row?.lastFailedAt ?? null,
		};
	}
}
