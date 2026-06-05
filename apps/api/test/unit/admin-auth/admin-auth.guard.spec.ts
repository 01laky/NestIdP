import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ADMIN_SESSION_COOKIE_NAME } from '@nestidp/shared';
import { AdminAuthGuard } from '@api/admin-auth/guards/admin-auth.guard';
import { AdminAuthService } from '@api/admin-auth/services/admin-auth.service';
import { AdminAuthenticatedRequest } from '@api/admin-auth/admin-auth.types';
import { AdminSessionService } from '@api/admin-auth/services/admin-session.service';

describe('AdminAuthGuard', () => {
	const adminSessionService = {
		verify: jest.fn(),
		clearCookie: jest.fn(),
	};
	const adminAuthService = {
		resolveAuthenticatedAdmin: jest.fn(),
	};

	const guard = new AdminAuthGuard(
		adminSessionService as unknown as AdminSessionService,
		adminAuthService as unknown as AdminAuthService,
	);

	const response = { clearCookie: jest.fn() };

	function contextWithCookie(cookie?: string): ExecutionContext {
		return {
			switchToHttp: () => ({
				getRequest: () => ({
					cookies: cookie ? { [ADMIN_SESSION_COOKIE_NAME]: cookie } : {},
				}),
				getResponse: () => response,
			}),
		} as ExecutionContext;
	}

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('API-GRD-01: valid cookie → allows access', async () => {
		adminSessionService.verify.mockReturnValue({ adminUserId: 'a1', username: 'admin' });
		adminAuthService.resolveAuthenticatedAdmin.mockResolvedValue({ id: 'a1', username: 'admin' });

		const request = {
			cookies: { [ADMIN_SESSION_COOKIE_NAME]: 'token' },
		} as unknown as AdminAuthenticatedRequest;
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => request,
				getResponse: () => response,
			}),
		} as ExecutionContext;

		await expect(guard.canActivate(ctx)).resolves.toBe(true);
		expect(request.adminUser).toEqual({ id: 'a1', username: 'admin' });
	});

	it('API-GRD-02: missing cookie → 401', async () => {
		adminSessionService.verify.mockReturnValue(null);
		await expect(guard.canActivate(contextWithCookie())).rejects.toThrow(UnauthorizedException);
	});

	it('API-GRD-03: expired cookie → 401', async () => {
		adminSessionService.verify.mockReturnValue(null);
		await expect(guard.canActivate(contextWithCookie('expired'))).rejects.toThrow(
			UnauthorizedException,
		);
	});

	it('API-GRD-04: valid cookie but admin row deleted from DB → 401', async () => {
		adminSessionService.verify.mockReturnValue({ adminUserId: 'gone', username: 'admin' });
		adminAuthService.resolveAuthenticatedAdmin.mockRejectedValue(
			new UnauthorizedException('Unauthorized'),
		);

		await expect(guard.canActivate(contextWithCookie('token'))).rejects.toThrow(
			UnauthorizedException,
		);
		expect(adminSessionService.clearCookie).toHaveBeenCalled();
	});

	it('API-GRD-05: empty string cookie treated as missing', async () => {
		adminSessionService.verify.mockReturnValue(null);
		const ctx = {
			switchToHttp: () => ({
				getRequest: () => ({ cookies: { [ADMIN_SESSION_COOKIE_NAME]: '' } }),
				getResponse: () => response,
			}),
		} as ExecutionContext;
		await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
	});

	it('API-GRD-06: verify returning null for garbage token → 401', async () => {
		adminSessionService.verify.mockReturnValue(null);
		await expect(guard.canActivate(contextWithCookie('garbage.token'))).rejects.toThrow(
			UnauthorizedException,
		);
	});
});
