import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SchedulerTickStats } from '@nestidp/shared';
import { parseBoolEnv } from '../../common/config/parse-bool-env.util';
import { CertRotationConfig } from '../cert-rotation.config';
import { IdpSettingsService } from './idp-settings.service';

/**
 * Drives automatic certificate rotation (Prompt 34): a single in-process `setInterval` that, each tick,
 * asks {@link IdpSettingsService.runAutoRotationCheck} to evaluate signing + encryption and start /
 * complete rotations as the lead/overlap windows dictate. Mirrors `SyncSchedulerService`:
 * `CERT_ROTATION_SCHEDULER_TICK_MS` (`0` disables), fresh-DB read per tick, single instance only.
 * Re-entrancy-guarded (key generation shells out to openssl) and jitter-spread.
 */
@Injectable()
export class CertRotationSchedulerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(CertRotationSchedulerService.name);
	private intervalHandle: ReturnType<typeof setInterval> | null = null;
	private ticking = false;
	private bootTickPending = true;
	private lastTickAt: string | null = null;
	private lastProcessed: number | null = null;

	constructor(
		private readonly idpSettingsService: IdpSettingsService,
		private readonly config: CertRotationConfig,
		private readonly configService: ConfigService,
	) {}

	onModuleInit(): void {
		if (this.isMigrateOnly()) {
			return;
		}
		const tickMs = this.config.tickMs();
		if (tickMs <= 0) {
			this.logger.log(
				JSON.stringify({
					event: 'cert_rotation_scheduler_disabled',
					reason: 'CERT_ROTATION_SCHEDULER_TICK_MS=0',
				}),
			);
			return;
		}
		this.intervalHandle = setInterval(() => {
			void this.runTick();
		}, tickMs);
		this.logger.log(JSON.stringify({ event: 'cert_rotation_scheduler_started', tickMs }));
	}

	onModuleDestroy(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	/** Liveness gauge for /health: last completed tick + cert kinds it evaluated. */
	tickStats(): SchedulerTickStats {
		return { lastTickAt: this.lastTickAt, lastProcessed: this.lastProcessed };
	}

	/** One scheduler tick: jitter, then a re-entrancy-guarded auto-rotation evaluation. */
	async runTick(): Promise<void> {
		if (this.ticking) {
			return; // a previous (slow, openssl-bound) tick is still running — never overlap
		}
		this.ticking = true;
		const trigger = this.bootTickPending ? 'boot' : 'scheduled';
		this.bootTickPending = false;
		const startedAtMs = Date.now();
		try {
			await this.applyJitter();
			await this.idpSettingsService.runAutoRotationCheck({ trigger });
			this.lastProcessed = 2; // one check evaluates both cert kinds (signing + encryption)
			this.logger.log(
				JSON.stringify({
					event: 'cert_rotation_tick_completed',
					durationMs: Date.now() - startedAtMs,
					trigger,
				}),
			);
		} catch (error) {
			this.logger.warn(
				JSON.stringify({ event: 'cert_rotation_tick_failed', message: messageOf(error) }),
			);
		} finally {
			this.lastTickAt = new Date().toISOString();
			this.ticking = false;
		}
	}

	// §18: injectable randomness — the old `Date.now() % range` was a deterministic function of
	// wall-clock (predictable, and instances ticking at aligned times collide), i.e. not jitter.
	// Tests pass a fixed `random` for determinism instead.
	private async applyJitter(random: () => number = Math.random): Promise<void> {
		const maxSeconds = this.config.jitterMaxSeconds();
		if (maxSeconds <= 0) {
			return;
		}
		const delayMs = Math.floor(random() * (maxSeconds * 1000 + 1));
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	private isMigrateOnly(): boolean {
		// §6.1: shared truthy-env parsing.
		return parseBoolEnv(this.configService.get<string>('MIGRATE_ONLY'));
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
