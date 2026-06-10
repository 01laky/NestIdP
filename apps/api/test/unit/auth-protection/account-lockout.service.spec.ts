import { AccountLockoutService } from '@api/auth-protection/account-lockout.service';
import type { RateLimitConfig } from '@api/auth-protection/rate-limit.config';

interface Row {
	id: string;
	scope: string;
	usernameKey: string;
	failedCount: number;
	lockedUntil: Date | null;
	lastFailedAt: Date | null;
	lastLockedAt: Date | null;
}

function fakePrisma() {
	const rows = new Map<string, Row>();
	const key = (scope: string, usernameKey: string) => `${scope}|${usernameKey}`;
	return {
		rows,
		loginLockout: {
			findUnique: jest.fn(async ({ where }: never) => {
				const { scope, usernameKey } = (where as never as { scope_usernameKey: Row })
					.scope_usernameKey;
				return rows.get(key(scope, usernameKey)) ?? null;
			}),
			upsert: jest.fn(async ({ where, create, update }: never) => {
				const { scope, usernameKey } = (where as never as { scope_usernameKey: Row })
					.scope_usernameKey;
				const k = key(scope, usernameKey);
				const existing = rows.get(k);
				let row: Row;
				if (existing) {
					const upd = update as Record<string, unknown>;
					// model Prisma's atomic { increment } for failedCount (§5.A5)
					const fc = upd.failedCount as number | { increment: number } | undefined;
					const resolvedFailed =
						fc && typeof fc === 'object' && 'increment' in fc
							? existing.failedCount + fc.increment
							: ((fc as number | undefined) ?? existing.failedCount);
					row = { ...existing, ...upd, failedCount: resolvedFailed } as Row;
				} else {
					row = {
						id: `id-${rows.size}`,
						scope,
						usernameKey,
						failedCount: 0,
						lockedUntil: null,
						lastFailedAt: null,
						lastLockedAt: null,
						...(create as object),
					} as Row;
				}
				rows.set(k, row);
				return row;
			}),
			update: jest.fn(async ({ where, data }: never) => {
				const { scope, usernameKey } = (where as never as { scope_usernameKey: Row })
					.scope_usernameKey;
				const k = key(scope, usernameKey);
				const existing = rows.get(k);
				if (!existing) {
					throw new Error('loginLockout row not found');
				}
				const row = { ...existing, ...(data as object) } as Row;
				rows.set(k, row);
				return row;
			}),
			deleteMany: jest.fn(async ({ where }: never) => {
				const w = where as never as {
					scope?: string;
					usernameKey?: string;
					OR?: Array<{
						lockedUntil?: { not?: null; lt?: Date } | null;
						lastFailedAt?: { lt?: Date };
					}>;
				};
				if (w.scope !== undefined && w.usernameKey !== undefined) {
					const k = key(w.scope, w.usernameKey);
					const had = rows.has(k);
					rows.delete(k);
					return { count: had ? 1 : 0 };
				}
				if (w.OR) {
					let count = 0;
					for (const [k, row] of [...rows.entries()]) {
						const expiredOld =
							row.lockedUntil !== null &&
							w.OR[0].lockedUntil?.lt !== undefined &&
							row.lockedUntil.getTime() < w.OR[0].lockedUntil.lt.getTime();
						const staleNeverLocked =
							row.lockedUntil === null &&
							w.OR[1].lastFailedAt?.lt !== undefined &&
							row.lastFailedAt !== null &&
							row.lastFailedAt.getTime() < w.OR[1].lastFailedAt.lt.getTime();
						if (expiredOld || staleNeverLocked) {
							rows.delete(k);
							count += 1;
						}
					}
					return { count };
				}
				return { count: 0 };
			}),
			findMany: jest.fn(async ({ where }: never) => {
				const w = where as never as { scope: string; usernameKey: { in: string[] } };
				return w.usernameKey.in.map((u) => rows.get(key(w.scope, u))).filter(Boolean) as Row[];
			}),
			count: jest.fn(async ({ where }: never) => {
				const w = where as never as { scope: string; lockedUntil: { gt: Date } };
				return [...rows.values()].filter(
					(r) =>
						r.scope === w.scope &&
						r.lockedUntil &&
						r.lockedUntil.getTime() > w.lockedUntil.gt.getTime(),
				).length;
			}),
		},
	};
}

function makeConfig(threshold: number, baseMs = 1000, maxMs = 10_000): RateLimitConfig {
	return {
		lockoutThreshold: jest.fn(() => threshold),
		lockoutBaseMs: jest.fn(() => baseMs),
		lockoutMaxMs: jest.fn(() => maxMs),
	} as unknown as RateLimitConfig;
}

describe('AccountLockoutService (Prompt 35)', () => {
	const t0 = new Date('2026-06-08T12:00:00.000Z');

	it('LOCK-01: below threshold → not locked', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(3));
		await svc.recordFailure('admin', 'admin', t0);
		await svc.recordFailure('admin', 'admin', t0);
		const check = await svc.check('admin', 'admin', t0);
		expect(check.locked).toBe(false);
	});

	it('LOCK-02: at threshold → locked at now + base', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(3, 1000));
		await svc.recordFailure('admin', 'admin', t0);
		await svc.recordFailure('admin', 'admin', t0);
		const res = await svc.recordFailure('admin', 'admin', t0);
		expect(res.lockedNow).toBe(true);
		expect(res.lockedUntil?.getTime()).toBe(t0.getTime() + 1000);
		const check = await svc.check('admin', 'admin', t0);
		expect(check.locked).toBe(true);
		expect(check.retryAfterMs).toBe(1000);
	});

	it('LOCK-04: backoff grows per extra failure and is clamped to max', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 1000, 4000));
		const r1 = await svc.recordFailure('admin', 'a', t0); // count1 -> base*2^0 = 1000
		const r2 = await svc.recordFailure('admin', 'a', t0); // count2 -> base*2^1 = 2000
		const r3 = await svc.recordFailure('admin', 'a', t0); // count3 -> base*2^2 = 4000 (clamp)
		const r4 = await svc.recordFailure('admin', 'a', t0); // count4 -> 8000 clamp -> 4000
		expect(r1.lockedUntil!.getTime() - t0.getTime()).toBe(1000);
		expect(r2.lockedUntil!.getTime() - t0.getTime()).toBe(2000);
		expect(r3.lockedUntil!.getTime() - t0.getTime()).toBe(4000);
		expect(r4.lockedUntil!.getTime() - t0.getTime()).toBe(4000);
	});

	it('LOCK-05: after expiry next attempt proceeds; success clears the row', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 1000));
		await svc.recordFailure('admin', 'a', t0); // locked until t0+1000
		const later = new Date(t0.getTime() + 2000);
		expect((await svc.check('admin', 'a', later)).locked).toBe(false);
		await svc.recordSuccess('admin', 'a');
		expect((await svc.getStatus('admin', 'a', later)).failedCount).toBe(0);
	});

	it('LOCK-06: threshold 0 disables the layer (no row written)', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(0));
		const res = await svc.recordFailure('admin', 'a', t0);
		expect(res.lockedNow).toBe(false);
		expect(prisma.rows.size).toBe(0);
		expect((await svc.check('admin', 'a', t0)).locked).toBe(false);
	});

	it('LOCK-08: scopes are independent', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 1000));
		await svc.recordFailure('admin', 'shared', t0);
		expect((await svc.check('admin', 'shared', t0)).locked).toBe(true);
		expect((await svc.check('end_user', 'shared', t0)).locked).toBe(false);
	});

	it('LOCK-09: state is read fresh from the store (survives a restart)', async () => {
		const prisma = fakePrisma();
		const svc1 = new AccountLockoutService(prisma as never, makeConfig(1, 5000));
		await svc1.recordFailure('admin', 'a', t0);
		// a brand-new service instance over the same store still sees the lock
		const svc2 = new AccountLockoutService(prisma as never, makeConfig(1, 5000));
		expect((await svc2.check('admin', 'a', t0)).locked).toBe(true);
	});

	it('UNLOCK-svc: unlock clears the row and reports whether one existed', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 1000));
		await svc.recordFailure('admin', 'a', t0);
		expect(await svc.unlock('admin', 'a')).toBe(true);
		expect(await svc.unlock('admin', 'a')).toBe(false);
		expect((await svc.check('admin', 'a', t0)).locked).toBe(false);
	});

	it('LOCK-11: prune deletes rows expired beyond the escalation-memory horizon', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 1000, 10_000));
		// lock 'old' far in the past so it is well beyond the horizon (max 10s)
		const longAgo = new Date(t0.getTime() - 60_000);
		await svc.recordFailure('admin', 'old', longAgo);
		// a fresh lock now — must survive the prune
		await svc.recordFailure('admin', 'fresh', t0);
		const removed = await svc.prune(t0);
		expect(removed).toBe(1);
		expect(prisma.rows.has('admin|old')).toBe(false);
		expect(prisma.rows.has('admin|fresh')).toBe(true);
	});

	it('status: getStatusMany + countLocked reflect locked accounts', async () => {
		const prisma = fakePrisma();
		const svc = new AccountLockoutService(prisma as never, makeConfig(1, 5000));
		await svc.recordFailure('end_user', 'u1', t0);
		await svc.recordFailure('end_user', 'u2', t0);
		const many = await svc.getStatusMany('end_user', ['u1', 'u2', 'u3'], t0);
		expect(many.get('u1')?.locked).toBe(true);
		expect(many.get('u3')?.locked).toBe(false);
		expect(await svc.countLocked('end_user', t0)).toBe(2);
	});

	it('LOCK-12: recordSuccess swallows store errors but logs them with key context (§5.C)', async () => {
		const prisma = fakePrisma();
		prisma.loginLockout.deleteMany.mockRejectedValueOnce(new Error('disk I/O error'));
		const svc = new AccountLockoutService(prisma as never, makeConfig(3));
		const warn = jest
			.spyOn((svc as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn')
			.mockImplementation(() => undefined);

		await expect(svc.recordSuccess('admin', 'alice')).resolves.toBeUndefined();

		expect(warn).toHaveBeenCalledTimes(1);
		const logged = JSON.parse(warn.mock.calls[0][0] as string) as Record<string, unknown>;
		expect(logged.event).toBe('lockout_reset_failed');
		expect(logged.usernameKey).toBe('alice');
		expect(logged.message).toContain('disk I/O error');
	});
});
