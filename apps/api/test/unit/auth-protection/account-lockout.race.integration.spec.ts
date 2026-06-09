import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '@api/prisma/services/prisma.service';
import { AccountLockoutService } from '@api/auth-protection/account-lockout.service';
import type { RateLimitConfig } from '@api/auth-protection/rate-limit.config';
import { runMigrationsOnTestDb } from '@test/support/prisma/test-db.helper';
import { runConcurrently } from '@test/support/concurrency/race.helper';

jest.setTimeout(60_000);

/**
 * Real-libSQL concurrency test for the atomic lockout increment (§5.A5). The old read-then-upsert
 * lost-update under concurrency: N parallel failures could land a count far below N. The atomic
 * `{ increment: 1 }` upsert guarantees `failedCount === N`.
 */
describe('AccountLockoutService concurrency (SQLite, §5.A5)', () => {
	let prisma: PrismaClient;
	let service: AccountLockoutService;
	let databaseUrl: string;

	// Very high threshold so the lock branch never interferes with the pure-increment assertion.
	const config = {
		lockoutThreshold: () => 1000,
		lockoutBaseMs: () => 1000,
		lockoutMaxMs: () => 10_000,
	} as unknown as RateLimitConfig;

	beforeAll(async () => {
		const tmpDb = join(tmpdir(), `nestidp-lockout-race-${randomUUID()}.db`);
		databaseUrl = `file:${tmpDb}`;
		await runMigrationsOnTestDb(databaseUrl);
		prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
		service = new AccountLockoutService(prisma as unknown as PrismaService, config);
	});

	afterAll(async () => {
		await prisma.$disconnect();
		try {
			unlinkSync(databaseUrl.replace(/^file:/, ''));
		} catch {
			// ignore
		}
	});

	it('LOCK-RACE-01: N concurrent recordFailure → failedCount === N (no lost update)', async () => {
		const N = 12;
		const now = new Date('2026-06-08T12:00:00.000Z');
		await runConcurrently(N, () => service.recordFailure('admin', 'race-target', now));

		const status = await service.getStatus('admin', 'race-target', now);
		expect(status.failedCount).toBe(N);
	});

	it('LOCK-RACE-02: concurrent failures across distinct accounts stay independent', async () => {
		const now = new Date('2026-06-08T13:00:00.000Z');
		await runConcurrently(8, (i) => service.recordFailure('admin', `acct-${i % 4}`, now));
		// 8 failures spread over 4 accounts → 2 each
		for (let i = 0; i < 4; i += 1) {
			const status = await service.getStatus('admin', `acct-${i}`, now);
			expect(status.failedCount).toBe(2);
		}
	});
});
