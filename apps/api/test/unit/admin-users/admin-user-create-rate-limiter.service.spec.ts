import { AdminUserCreateRateLimiterService } from '@api/admin-users/services/admin-user-create-rate-limiter.service';

describe('AdminUserCreateRateLimiterService', () => {
	const configService = {
		get: jest.fn((key: string) => {
			if (key === 'ADMIN_USER_CREATE_RATE_LIMIT_MAX') {
				return '3';
			}
			if (key === 'ADMIN_USER_CREATE_RATE_LIMIT_WINDOW_MS') {
				return '60000';
			}
			return undefined;
		}),
	};
	let service: AdminUserCreateRateLimiterService;

	beforeEach(() => {
		jest.clearAllMocks();
		service = new AdminUserCreateRateLimiterService(configService as never);
		service.clear();
	});

	it('API-ADM-USR-RL-01: not limited before max attempts', () => {
		service.recordAttempt('admin-1', '10.0.0.1');
		service.recordAttempt('admin-1', '10.0.0.1');
		expect(service.isLimited('admin-1', '10.0.0.1')).toBe(false);
	});

	it('API-ADM-USR-RL-02: limited after max attempts for same admin id', () => {
		service.recordAttempt('admin-1', '10.0.0.1');
		service.recordAttempt('admin-1', '10.0.0.1');
		service.recordAttempt('admin-1', '10.0.0.1');
		expect(service.isLimited('admin-1', '10.0.0.1')).toBe(true);
	});

	it('API-ADM-USR-RL-03: limited by client IP even when admin id differs', () => {
		service.recordAttempt('admin-a', '203.0.113.9');
		service.recordAttempt('admin-b', '203.0.113.9');
		service.recordAttempt('admin-c', '203.0.113.9');
		expect(service.isLimited('admin-z', '203.0.113.9')).toBe(true);
	});

	it('API-ADM-USR-RL-04: window expiry resets limit counter', () => {
		jest.useFakeTimers();
		service.recordAttempt('admin-1', '10.0.0.1');
		service.recordAttempt('admin-1', '10.0.0.1');
		service.recordAttempt('admin-1', '10.0.0.1');
		expect(service.isLimited('admin-1', '10.0.0.1')).toBe(true);
		jest.advanceTimersByTime(60_001);
		expect(service.isLimited('admin-1', '10.0.0.1')).toBe(false);
		jest.useRealTimers();
	});
});
