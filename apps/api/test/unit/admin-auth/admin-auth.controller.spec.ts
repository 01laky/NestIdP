import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { AdminAuthController } from '@api/admin-auth/controllers/admin-auth.controller';
import { AdminAuthService } from '@api/admin-auth/services/admin-auth.service';
import { AdminAuthenticatedRequest } from '@api/admin-auth/admin-auth.types';
import { AdminSessionService } from '@api/admin-auth/services/admin-session.service';
import { AdminCsrfService } from '@api/admin-auth/services/admin-csrf.service';
import { LoginProtectionService } from '@api/auth-protection/login-protection.service';

describe('AdminAuthController', () => {
	const adminAuthService = {
		login: jest.fn(),
	};
	const adminSessionService = {
		getSessionTtlSeconds: jest.fn(),
		createPayload: jest.fn(),
		setCookie: jest.fn(),
		clearCookie: jest.fn(),
		verify: jest.fn(),
	};
	const loginProtection = {
		precheckLogin: jest.fn(),
		enforceBlock: jest.fn(),
		recordLoginSuccess: jest.fn(),
		recordLoginFailure: jest.fn(),
	};
	const adminAuthAudit = {
		logLogout: jest.fn(),
	};
	const res = {
		cookie: jest.fn(),
		clearCookie: jest.fn(),
		setHeader: jest.fn(),
	} as unknown as Response;

	const controller = new AdminAuthController(
		adminAuthService as unknown as AdminAuthService,
		adminSessionService as unknown as AdminSessionService,
		loginProtection as unknown as LoginProtectionService,
		adminAuthAudit as never,
		new AdminCsrfService(),
	);

	beforeEach(() => {
		jest.clearAllMocks();
		loginProtection.precheckLogin.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
		loginProtection.enforceBlock.mockImplementation(() => {
			throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
		});
		adminSessionService.getSessionTtlSeconds.mockReturnValue(28_800);
	});

	it('API-CTL-01: login success returns ok and admin without passwordHash', async () => {
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.createPayload.mockReturnValue({
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'csrf-token-value',
		});

		const result = await controller.login(
			{ username: 'admin', password: 'secret' },
			{ ip: '127.0.0.1' } as AdminAuthenticatedRequest,
			res,
		);

		expect(result).toEqual({
			ok: true,
			admin: { id: 'a1', username: 'admin' },
			csrfToken: 'csrf-token-value',
		});
		expect(result.admin).not.toHaveProperty('passwordHash');
	});

	it('API-CTL-02: login sets session cookie and records success', async () => {
		const payload = {
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'csrf-token-value',
		};
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.createPayload.mockReturnValue(payload);

		await controller.login(
			{ username: 'admin', password: 'secret' },
			{ ip: '127.0.0.1' } as AdminAuthenticatedRequest,
			res,
		);

		expect(adminSessionService.setCookie).toHaveBeenCalledWith(res, payload, {
			persistent: false,
		});
		expect(loginProtection.recordLoginSuccess).toHaveBeenCalledWith('admin', 'admin', '127.0.0.1');
	});

	it('API-CTL-10: rememberMe true uses long TTL and persistent cookie', async () => {
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.getSessionTtlSeconds.mockReturnValue(2_592_000);
		const payload = {
			adminUserId: 'a1',
			username: 'admin',
			iat: 100,
			exp: 100 + 2_592_000,
			csrfToken: 'csrf-token-value',
		};
		adminSessionService.createPayload.mockReturnValue(payload);

		await controller.login(
			{ username: 'admin', password: 'secret', rememberMe: true },
			{ ip: '127.0.0.1' } as AdminAuthenticatedRequest,
			res,
		);

		expect(adminAuthService.login).toHaveBeenCalledWith('admin', 'secret', '127.0.0.1', true);
		expect(adminSessionService.getSessionTtlSeconds).toHaveBeenCalledWith(true);
		expect(adminSessionService.createPayload).toHaveBeenCalledWith(
			'a1',
			'admin',
			undefined,
			2_592_000,
		);
		expect(adminSessionService.setCookie).toHaveBeenCalledWith(res, payload, {
			persistent: true,
		});
	});

	it('API-CTL-12: omitted rememberMe passes false persistent flag to session', async () => {
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.createPayload.mockReturnValue({
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'csrf',
		});

		await controller.login(
			{ username: 'admin', password: 'secret' },
			{ ip: '127.0.0.1' } as AdminAuthenticatedRequest,
			res,
		);

		expect(adminAuthService.login).toHaveBeenCalledWith('admin', 'secret', '127.0.0.1', false);
		expect(adminSessionService.getSessionTtlSeconds).toHaveBeenCalledWith(false);
		expect(adminSessionService.setCookie).toHaveBeenCalledWith(res, expect.any(Object), {
			persistent: false,
		});
	});

	it('API-CTL-11: rememberMe false uses short TTL and non-persistent cookie', async () => {
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.getSessionTtlSeconds.mockReturnValue(28_800);
		const payload = {
			adminUserId: 'a1',
			username: 'admin',
			iat: 200,
			exp: 200 + 28_800,
			csrfToken: 'csrf',
		};
		adminSessionService.createPayload.mockReturnValue(payload);

		await controller.login(
			{ username: 'admin', password: 'secret', rememberMe: false },
			{ ip: '127.0.0.1' } as AdminAuthenticatedRequest,
			res,
		);

		expect(adminSessionService.setCookie).toHaveBeenCalledWith(res, payload, {
			persistent: false,
		});
	});

	it('API-CTL-03: login records protection failure on unauthorized', async () => {
		adminAuthService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

		await expect(
			controller.login(
				{ username: 'admin', password: 'wrong' },
				{ ip: '10.0.0.1' } as AdminAuthenticatedRequest,
				res,
			),
		).rejects.toThrow(UnauthorizedException);

		expect(loginProtection.recordLoginFailure).toHaveBeenCalledWith('admin', 'admin', '10.0.0.1');
		expect(loginProtection.recordLoginSuccess).not.toHaveBeenCalled();
	});

	it('API-CTL-04: blocked login throws 429 before hitting the auth service', async () => {
		loginProtection.precheckLogin.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });

		await expect(
			controller.login(
				{ username: 'admin', password: 'secret' },
				{ ip: '10.0.0.2' } as AdminAuthenticatedRequest,
				res,
			),
		).rejects.toMatchObject({ status: 429 });

		expect(adminAuthService.login).not.toHaveBeenCalled();
	});

	it('API-CTL-05: logout clears cookie and returns ok when no session', () => {
		adminSessionService.verify.mockReturnValue(null);
		expect(controller.logout({ cookies: {} } as AdminAuthenticatedRequest, res)).toEqual({
			ok: true,
		});
		expect(adminSessionService.clearCookie).toHaveBeenCalledWith(res);
	});

	it('API-CTL-09: logout with session requires matching CSRF header', () => {
		adminSessionService.verify.mockReturnValue({
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'expected-csrf',
		});

		expect(() =>
			controller.logout({ cookies: {}, headers: {} } as AdminAuthenticatedRequest, res),
		).toThrow('Invalid CSRF token');
	});

	it('API-CTL-10: logout with matching CSRF audits via the session payload identity (§5.A7)', () => {
		adminSessionService.verify.mockReturnValue({
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'expected-csrf',
		});

		const result = controller.logout(
			{
				cookies: {},
				headers: { 'x-csrf-token': 'expected-csrf' },
				ip: '10.0.0.9',
				// note: no req.adminUser (AdminAuthGuard is not applied to logout)
			} as unknown as AdminAuthenticatedRequest,
			res,
		);

		expect(result).toEqual({ ok: true });
		expect(adminAuthAudit.logLogout).toHaveBeenCalledWith('a1', 'admin', '10.0.0.9');
		expect(adminSessionService.clearCookie).toHaveBeenCalledWith(res);
	});

	it('API-CTL-06: me throws when adminUser missing on request', () => {
		expect(() => controller.me({} as AdminAuthenticatedRequest)).toThrow(UnauthorizedException);
	});

	it('API-CTL-07: login uses unknown ip fallback when req.ip missing', async () => {
		adminAuthService.login.mockResolvedValue({ id: 'a1', username: 'admin' });
		adminSessionService.createPayload.mockReturnValue({
			adminUserId: 'a1',
			username: 'admin',
			iat: 1,
			exp: 2,
			csrfToken: 'csrf-token-value',
		});

		await controller.login(
			{ username: 'admin', password: 'secret' },
			{} as AdminAuthenticatedRequest,
			res,
		);

		expect(loginProtection.recordLoginSuccess).toHaveBeenCalledWith('admin', 'admin', 'unknown');
	});

	it('API-CTL-08: blocked login 429 uses HttpException with message', async () => {
		loginProtection.precheckLogin.mockResolvedValue({ allowed: false, retryAfterMs: 1000 });

		try {
			await controller.login(
				{ username: 'admin', password: 'x' },
				{ ip: '1.1.1.1' } as AdminAuthenticatedRequest,
				res,
			);
			fail('expected throw');
		} catch (error) {
			expect(error).toBeInstanceOf(HttpException);
			expect((error as HttpException).message).toBe('Too many login attempts');
		}
	});
});
