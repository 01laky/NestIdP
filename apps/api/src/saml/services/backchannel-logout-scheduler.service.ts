import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackchannelLogoutConfig } from './backchannel-logout.config';
import { LogoutPropagationService } from './logout-propagation.service';

/**
 * Drives back-channel (SOAP) SLO retries + prune (Prompt 36): a single in-process `setInterval` that each
 * tick processes due deliveries and periodically prunes resolved rows. Mirrors the cert-rotation / sync
 * schedulers — `SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS` (`0` disables), re-entrancy-guarded, fresh-DB
 * read per tick, single instance. Never throws out of the tick.
 */
@Injectable()
export class BackchannelLogoutSchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(BackchannelLogoutSchedulerService.name);
	private handle: ReturnType<typeof setInterval> | null = null;
	private ticking = false;
	private lastPruneMs = 0;

	constructor(
		private readonly propagation: LogoutPropagationService,
		private readonly config: BackchannelLogoutConfig,
		private readonly configService: ConfigService,
	) {}

	onModuleInit(): void {
		const raw = (this.configService.get<string>('MIGRATE_ONLY') ?? '').toLowerCase();
		if (raw === '1' || raw === 'true') {
			return;
		}
		const tickMs = this.config.schedulerTickMs();
		if (tickMs <= 0) {
			this.logger.log(
				JSON.stringify({
					event: 'backchannel_logout_scheduler_disabled',
					reason: 'SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS=0',
				}),
			);
			return;
		}
		this.handle = setInterval(() => void this.runTick(), tickMs);
		this.logger.log(JSON.stringify({ event: 'backchannel_logout_scheduler_started', tickMs }));
	}

	onModuleDestroy(): void {
		if (this.handle) {
			clearInterval(this.handle);
			this.handle = null;
		}
	}

	/** One tick: process due deliveries + occasional prune. Re-entrancy-guarded; never throws. */
	async runTick(): Promise<void> {
		if (this.ticking) {
			return;
		}
		this.ticking = true;
		try {
			await this.propagation.processDue();
			const pruneInterval = this.config.pruneIntervalMs();
			if (pruneInterval > 0 && Date.now() - this.lastPruneMs >= pruneInterval) {
				this.lastPruneMs = Date.now();
				const removed = await this.propagation.prune();
				if (removed > 0) {
					this.logger.log(JSON.stringify({ event: 'backchannel_logout_pruned', removed }));
				}
			}
		} catch (error) {
			this.logger.warn(
				JSON.stringify({
					event: 'backchannel_logout_tick_failed',
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} finally {
			this.ticking = false;
		}
	}
}
