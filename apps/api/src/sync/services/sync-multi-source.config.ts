import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUsernameCollisionPolicy, type UsernameCollisionPolicy } from '@nestidp/shared';
import { boundedInt as boundedIntFromRaw } from '../../common/config/bounded-int.util';

/**
 * Bounded env config for "multiple API connections for sync" (Prompt 37). Mirrors the bounded-int style of
 * the cert-rotation / back-channel configs. Defaults keep a single-connection deployment behaving exactly
 * as before.
 */
@Injectable()
export class SyncMultiSourceConfig {
	constructor(private readonly configService: ConfigService) {}

	/** Global cross-connection username collision policy; a per-connection override takes precedence. */
	usernameCollisionPolicy(): UsernameCollisionPolicy {
		const raw = String(
			this.configService.get<string>('SYNC_USERNAME_COLLISION_POLICY') ?? '',
		).toLowerCase();
		return isUsernameCollisionPolicy(raw) ? raw : 'skip';
	}

	/** Max connections synced concurrently by "sync all"; `1` = sequential (deterministic winner order). */
	syncAllConcurrency(): number {
		return this.boundedInt('SYNC_ALL_CONCURRENCY', 1, 1, 16);
	}

	/** A scheduled source is "overdue" when `lastSyncAt` is older than its cron interval × this factor. */
	syncSourceStaleFactor(): number {
		return this.boundedInt('SYNC_SOURCE_STALE_FACTOR', 3, 1, 50);
	}

	private boundedInt(key: string, fallback: number, min: number, max: number): number {
		// §6.1: delegate to the shared helper (adds correct empty-string handling).
		return boundedIntFromRaw(this.configService.get<number | string>(key), fallback, min, max);
	}
}
