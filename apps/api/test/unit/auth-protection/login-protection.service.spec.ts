import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';

function deps(overrides: Record<string, unknown> = {}) {
	const config = {
		loginIpMax: jest.fn(() => 100),
		loginIpWindowMs: jest.fn(() => 10_000),
		loginUsernameMax: jest.fn(() => 100),
		loginUsernameWindowMs: jest.fn(() => 10_000),
		ssoIpMax: jest.fn(() => 100),
		ssoWindowMs: jest.fn(() => 10_000),
		trustedCidrs: jest.fn(() => [] as string[]),
		tarpitBaseMs: jest.fn(() => 0),
		responseMode: jest.fn(() => 'retry_after'),
		...overrides,
	};
	const lockout = {
		check: jest.fn().mockResolvedValue({ locked: false, lockedUntil: null, retryAfterMs: 0 }),
		recordFailure: jest
			.fn()
			.mockResolvedValue({ lockedNow: false, failedCount: 1, lockedUntil: null }),
		recordSuccess: jest.fn().mockResolvedValue(undefined),
	};
	const ipBan = {
		check: jest.fn(() => ({ banned: false, retryAfterMs: 0 })),
		recordTrip: jest.fn(() => ({ bannedNow: false, count: 0, bannedUntil: null })),
		clear: jest.fn(),
	};
	const audit = {
		logRateLimited: jest.fn(),
		logAccountLocked: jest.fn(),
		logIpBanned: jest.fn(),
	};
	const notifier = {
		onAccountLocked: jest.fn(),
		onIpBanned: jest.fn(),
		onAccountUnlocked: jest.fn(),
	};
	const svc = new LoginProtectionService(
		config as never,
		lockout as never,
		ipBan as never,
		audit as never,
		notifier as never,
	);
	return { svc, config, lockout, ipBan, audit, notifier };
}

describe('LoginProtectionService (Prompt 35)', () => {
	it('LP-01: a clean attempt is allowed', async () => {
		const { svc } = deps();
		expect((await svc.precheckLogin('admin', 'admin', '1.2.3.4')).allowed).toBe(true);
	});

	it('LP-02: username throttle blocks once the per-username max is exceeded', async () => {
		const { svc } = deps({ loginUsernameMax: jest.fn(() => 2) });
		await svc.recordLoginFailure('end_user', 'bob', '1.2.3.4');
		await svc.recordLoginFailure('end_user', 'bob', '1.2.3.4');
		const pre = await svc.precheckLogin('end_user', 'bob', '1.2.3.4');
		expect(pre.allowed).toBe(false);
		expect(pre.reason).toBe('username_throttle');
	});

	it('TRUST-01/02: a trusted IP bypasses throttle + ban but NOT account lockout', async () => {
		const { svc, lockout, ipBan } = deps({
			loginIpMax: jest.fn(() => 1),
			trustedCidrs: jest.fn(() => ['10.0.0.0/8']),
		});
		// many failures from a trusted IP never trip the throttle/ban
		await svc.recordLoginFailure('end_user', 'x', '10.1.2.3');
		await svc.recordLoginFailure('end_user', 'x', '10.1.2.3');
		expect((await svc.precheckLogin('end_user', 'x', '10.1.2.3')).allowed).toBe(true);
		expect(ipBan.check).not.toHaveBeenCalled();
		// but if the account itself is locked, even a trusted IP is blocked
		lockout.check.mockResolvedValueOnce({
			locked: true,
			lockedUntil: new Date(),
			retryAfterMs: 500,
		});
		const pre = await svc.precheckLogin('end_user', 'x', '10.1.2.3');
		expect(pre.allowed).toBe(false);
		expect(pre.reason).toBe('lockout');
	});

	it('LP-03: an active lockout blocks the precheck', async () => {
		const { svc, lockout } = deps();
		lockout.check.mockResolvedValue({ locked: true, lockedUntil: new Date(), retryAfterMs: 1000 });
		const pre = await svc.precheckLogin('admin', 'admin', '1.2.3.4');
		expect(pre.allowed).toBe(false);
		expect(pre.reason).toBe('lockout');
	});

	it('LP-04: a failure that locks the account audits + notifies + records an IP trip', async () => {
		const { svc, lockout, audit, notifier, ipBan } = deps();
		lockout.recordFailure.mockResolvedValue({
			lockedNow: true,
			failedCount: 5,
			lockedUntil: new Date(Date.now() + 1000),
		});
		await svc.recordLoginFailure('admin', 'admin', '1.2.3.4');
		expect(audit.logAccountLocked).toHaveBeenCalledWith(
			'admin',
			'admin',
			'1.2.3.4',
			5,
			expect.any(Date),
		);
		expect(notifier.onAccountLocked).toHaveBeenCalled();
		expect(ipBan.recordTrip).toHaveBeenCalledWith('1.2.3.4');
	});

	it('LP-05: success resets the account lockout', async () => {
		const { svc, lockout } = deps();
		await svc.recordLoginSuccess('end_user', 'alice', '1.2.3.4');
		expect(lockout.recordSuccess).toHaveBeenCalledWith('end_user', 'alice');
	});

	it('RESP-01: enforceBlock retry_after sets Retry-After and throws 429', () => {
		const { svc } = deps();
		const res = { setHeader: jest.fn() } as unknown as Response;
		expect(() => svc.enforceBlock({ allowed: false, retryAfterMs: 2000 }, res)).toThrow(
			HttpException,
		);
		expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '2');
	});

	it('RESP-02: enforceBlock opaque throws a generic 401 with no Retry-After', () => {
		const { svc } = deps({ responseMode: jest.fn(() => 'opaque') });
		const res = { setHeader: jest.fn() } as unknown as Response;
		expect(() => svc.enforceBlock({ allowed: false, retryAfterMs: 2000 }, res)).toThrow(
			UnauthorizedException,
		);
		expect(res.setHeader).not.toHaveBeenCalled();
	});

	it('RL-SSO: SSO precheck throttles by IP once the SSO max is exceeded', () => {
		const { svc } = deps({ ssoIpMax: jest.fn(() => 2) });
		expect(svc.precheckSso('1.2.3.4').allowed).toBe(true); // 1
		expect(svc.precheckSso('1.2.3.4').allowed).toBe(true); // 2
		expect(svc.precheckSso('1.2.3.4').allowed).toBe(false); // 3 → blocked
	});

	it('TARPIT-01: a positive tarpit base delays the failure path', async () => {
		jest.useFakeTimers();
		try {
			const { svc, lockout } = deps({ tarpitBaseMs: jest.fn(() => 100) });
			lockout.recordFailure.mockResolvedValue({
				lockedNow: false,
				failedCount: 3,
				lockedUntil: null,
			});
			const p = svc.recordLoginFailure('end_user', 'x', '1.2.3.4');
			let resolved = false;
			void p.then(() => {
				resolved = true;
			});
			await Promise.resolve();
			expect(resolved).toBe(false); // still tarpitting
			await jest.advanceTimersByTimeAsync(300);
			await p;
			expect(resolved).toBe(true);
		} finally {
			jest.useRealTimers();
		}
	});
});
