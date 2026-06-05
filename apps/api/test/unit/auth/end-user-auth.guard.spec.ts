import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { END_USER_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { EndUserAuthGuard } from '@api/auth/guards/end-user-auth.guard';
import { EndUserAuthService } from '@api/auth/services/end-user-auth.service';
import { EndUserSessionService } from '@api/auth/services/end-user-session.service';
import type { EndUserAuthenticatedRequest } from '@api/auth/end-user-auth.types';

describe('EndUserAuthGuard', () => {
	const endUserSessionService = {
		verify: jest.fn(),
		clearCookie: jest.fn(),
	};
	const endUserAuthService = {
		getMe: jest.fn(),
	};

	const guard = new EndUserAuthGuard(
		endUserSessionService as unknown as EndUserSessionService,
		endUserAuthService as unknown as EndUserAuthService,
	);

	const response = { clearCookie: jest.fn() };

	function contextWithCookie(cookie?: string): ExecutionContext {
		return {
			switchToHttp: () => ({
				getRequest: () => ({
					cookies: cookie ? { [END_USER_SESSION_COOKIE_NAME]: cookie } : {},
				}),
				getResponse: () => response,
			}),
		} as ExecutionContext;
	}

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-AUTH-GUARD-01: valid cookie → allows access', async () => {
		endUserSessionService.verify.mockReturnValue({ userId: 'u1', username: 'alice' });
		endUserAuthService.getMe.mockResolvedValue({
			id: 'u1',
			username: 'alice',
			email: null,
			displayName: null,
			groups: [],
			roles: [],
		});

		const request = {
			cookies: { [END_USER_SESSION_COOKIE_NAME]: 'token' },
		} as unknown as EndUserAuthenticatedRequest;
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => request,
				getResponse: () => response,
			}),
		} as ExecutionContext;

		await expect(guard.canActivate(ctx)).resolves.toBe(true);
		expect(request.endUser?.username).toBe('alice');
	});

	it('API-AUTH-GUARD-02: missing cookie → 401', async () => {
		endUserSessionService.verify.mockReturnValue(null);
		await expect(guard.canActivate(contextWithCookie())).rejects.toThrow(UnauthorizedException);
	});

	it('API-AUTH-GUARD-03: expired cookie → 401', async () => {
		endUserSessionService.verify.mockReturnValue(null);
		await expect(guard.canActivate(contextWithCookie('expired'))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('API-AUTH-GUARD-04: valid cookie but user deleted → 401 and clears cookie', async () => {
		endUserSessionService.verify.mockReturnValue({ userId: 'gone', username: 'alice' });
		endUserAuthService.getMe.mockRejectedValue(new UnauthorizedException('Unauthorized'));

		await expect(guard.canActivate(contextWithCookie('token'))).rejects.toThrow(
			UnauthorizedException,
		);
		expect(endUserSessionService.clearCookie).toHaveBeenCalled();
	});

	it('API-AUTH-GUARD-05: empty string cookie treated as missing', async () => {
		endUserSessionService.verify.mockReturnValue(null);
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => ({ cookies: { [END_USER_SESSION_COOKIE_NAME]: '' } }),
				getResponse: () => response,
			}),
		} as ExecutionContext;
		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
	});
});
