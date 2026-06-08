import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountLockoutService } from './account-lockout.service';
import { RateLimitConfig } from './rate-limit.config';

/**
 * Periodic sweep that deletes long-stale `LoginLockout` rows so the table cannot grow without bound under
 * credential stuffing across many usernames (Prompt 35). Single in-process `setInterval`, cleared on
 * shutdown, interval from `LOGIN_LOCKOUT_PRUNE_INTERVAL_MS` (`0` disables) — mirrors the scheduler shape.
 * A failed sweep is logged and swallowed; it never throws out of the tick or blocks boot.
 */
@Injectable()
export class LockoutPruneService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(LockoutPruneService.name);
	private handle: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(
		private readonly lockout: AccountLockoutService,
		private readonly config: RateLimitConfig,
		private readonly configService: ConfigService,
	) {}

	onModuleInit(): void {
		const raw = (this.configService.get<string>('MIGRATE_ONLY') ?? '').toLowerCase();
		if (raw === '1' || raw === 'true') {
			return;
		}
		const intervalMs = this.config.lockoutPruneIntervalMs();
		if (intervalMs <= 0) {
			this.logger.log(
				JSON.stringify({
					event: 'lockout_prune_disabled',
					reason: 'LOGIN_LOCKOUT_PRUNE_INTERVAL_MS=0',
				}),
			);
			return;
		}
		this.handle = setInterval(() => void this.runOnce(), intervalMs);
		this.logger.log(JSON.stringify({ event: 'lockout_prune_started', intervalMs }));
	}

	onModuleDestroy(): void {
		if (this.handle) {
			clearInterval(this.handle);
			this.handle = null;
		}
	}

	/** One sweep — re-entrancy-guarded; logs the count removed; never throws. */
	async runOnce(): Promise<void> {
		if (this.running) {
			return;
		}
		this.running = true;
		try {
			const removed = await this.lockout.prune();
			if (removed > 0) {
				this.logger.log(JSON.stringify({ event: 'lockout_pruned', removed }));
			}
		} catch (error) {
			this.logger.warn(
				JSON.stringify({
					event: 'lockout_prune_failed',
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			this.running = false;
		}
	}
}
