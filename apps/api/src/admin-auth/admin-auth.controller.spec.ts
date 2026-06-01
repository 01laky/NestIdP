import { HttpException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthenticatedRequest } from './admin-auth.types';
import { AdminSessionService } from './admin-session.service';
import { LoginRateLimiterService } from './login-rate-limiter.service';

describe('AdminAuthController', () => {
	const adminAuthService = {
		login: jest.fn(),
	};
	const adminSessionService = {
		createPayload: jest.fn(),
		setCookie: jest.fn(),
		clearCookie: jest.fn(),
		verify: jest.fn(),
	};
	const loginRateLimiter = {
		isLimited: jest.fn(),
		recordFailure: jest.fn(),
		reset: jest.fn(),
	};
	const res = { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response;

	const controller = new AdminAuthController(
		adminAuthService as unknown as AdminAuthService,
		adminSessionService as unknown as AdminSessionService,
		loginRateLimiter as unknown as LoginRateLimiterService,
	);

	beforeEach(() => {
		jest.clearAllMocks();
		loginRateLimiter.isLimited.mockReturnValue(false);
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

	it('API-CTL-02: login sets session cookie on success', async () => {
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

		expect(adminSessionService.setCookie).toHaveBeenCalledWith(res, payload);
		expect(loginRateLimiter.reset).toHaveBeenCalledWith('127.0.0.1');
	});

	it('API-CTL-03: login records rate limit failure on unauthorized', async () => {
		adminAuthService.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));

		await expect(
			controller.login(
				{ username: 'admin', password: 'wrong' },
				{ ip: '10.0.0.1' } as AdminAuthenticatedRequest,
				res,
			),
		).rejects.toThrow(UnauthorizedException);

		expect(loginRateLimiter.recordFailure).toHaveBeenCalledWith('10.0.0.1');
		expect(loginRateLimiter.reset).not.toHaveBeenCalled();
	});

	it('API-CTL-04: rate limited login throws 429', async () => {
		loginRateLimiter.isLimited.mockReturnValue(true);

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

		expect(loginRateLimiter.reset).toHaveBeenCalledWith('unknown');
	});

	it('API-CTL-08: rate limit 429 uses HttpException with message', async () => {
		loginRateLimiter.isLimited.mockReturnValue(true);

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
