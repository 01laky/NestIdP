import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminCsrfGuard } from './admin-csrf.guard';
import { AdminCsrfService } from './admin-csrf.service';

describe('AdminCsrfGuard', () => {
	const csrfService = new AdminCsrfService();
	const guard = new AdminCsrfGuard(csrfService);

	function contextWith(headers: Record<string, string>, csrfToken?: string): ExecutionContext {
		return {
			switchToHttp: () => ({
				getRequest: () => ({
					headers,
					adminSession: csrfToken !== undefined ? { csrfToken } : undefined,
				}),
			}),
		} as ExecutionContext;
	}

	it('API-CSRF-01: mutating request without header → 403', () => {
		expect(() => guard.canActivate(contextWith({}, 'expected-token'))).toThrow(ForbiddenException);
	});

	it('API-CSRF-02: mutating request with wrong header → 403', () => {
		expect(() =>
			guard.canActivate(contextWith({ 'x-csrf-token': 'wrong' }, 'expected-token')),
		).toThrow(ForbiddenException);
	});

	it('API-CSRF-06: legacy session without csrfToken → 403', () => {
		expect(() => guard.canActivate(contextWith({ 'x-csrf-token': 'any' }, undefined))).toThrow(
			ForbiddenException,
		);
	});

	it('allows request when header matches session csrfToken', () => {
		const token = csrfService.generateToken();
		expect(guard.canActivate(contextWith({ 'x-csrf-token': token }, token))).toBe(true);
	});
});
