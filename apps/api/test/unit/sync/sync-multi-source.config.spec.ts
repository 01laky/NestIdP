import { ConfigService } from '@nestjs/config';
import { SyncMultiSourceConfig } from '@api/sync/services/sync-multi-source.config';

/** Bounded env config for multi-source sync (Prompt 37, MAS-CFG-01). */
describe('SyncMultiSourceConfig', () => {
	function make(values: Record<string, unknown>): SyncMultiSourceConfig {
		const stub = { get: (key: string) => values[key] } as unknown as ConfigService;
		return new SyncMultiSourceConfig(stub);
	}

	it('defaults when unset', () => {
		const c = make({});
		expect(c.usernameCollisionPolicy()).toBe('skip');
		expect(c.syncAllConcurrency()).toBe(1);
		expect(c.syncSourceStaleFactor()).toBe(3);
	});

	it('accepts valid collision policy (case-insensitive); invalid → skip', () => {
		expect(make({ SYNC_USERNAME_COLLISION_POLICY: 'fail_run' }).usernameCollisionPolicy()).toBe(
			'fail_run',
		);
		expect(make({ SYNC_USERNAME_COLLISION_POLICY: 'FAIL_RUN' }).usernameCollisionPolicy()).toBe(
			'fail_run',
		);
		expect(make({ SYNC_USERNAME_COLLISION_POLICY: 'nonsense' }).usernameCollisionPolicy()).toBe(
			'skip',
		);
	});

	it('clamps SYNC_ALL_CONCURRENCY to [1,16] and falls back on non-numeric', () => {
		expect(make({ SYNC_ALL_CONCURRENCY: 4 }).syncAllConcurrency()).toBe(4);
		expect(make({ SYNC_ALL_CONCURRENCY: '8' }).syncAllConcurrency()).toBe(8);
		expect(make({ SYNC_ALL_CONCURRENCY: 0 }).syncAllConcurrency()).toBe(1);
		expect(make({ SYNC_ALL_CONCURRENCY: 999 }).syncAllConcurrency()).toBe(1);
		expect(make({ SYNC_ALL_CONCURRENCY: 'abc' }).syncAllConcurrency()).toBe(1);
		expect(make({ SYNC_ALL_CONCURRENCY: 16 }).syncAllConcurrency()).toBe(16);
	});

	it('clamps SYNC_SOURCE_STALE_FACTOR to [1,50]', () => {
		expect(make({ SYNC_SOURCE_STALE_FACTOR: 10 }).syncSourceStaleFactor()).toBe(10);
		expect(make({ SYNC_SOURCE_STALE_FACTOR: 0 }).syncSourceStaleFactor()).toBe(3);
		expect(make({ SYNC_SOURCE_STALE_FACTOR: 99 }).syncSourceStaleFactor()).toBe(3);
		expect(make({ SYNC_SOURCE_STALE_FACTOR: 1 }).syncSourceStaleFactor()).toBe(1);
		expect(make({ SYNC_SOURCE_STALE_FACTOR: 50 }).syncSourceStaleFactor()).toBe(50);
	});
});
