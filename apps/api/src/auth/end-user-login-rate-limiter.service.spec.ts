import { ConfigService } from '@nestjs/config';
import { EndUserLoginRateLimiterService } from './end-user-login-rate-limiter.service';

describe('EndUserLoginRateLimiterService', () => {
	const config = {
		get: jest.fn(() => undefined),
	} as unknown as ConfigService;

	it('API-AUTH-RATE-01: 10 IP failures → 11th limited by IP', () => {
		const limiter = new EndUserLoginRateLimiterService(config);
		const ip = '1.2.3.4';

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure(ip, 'alice');
		}

		expect(limiter.isLimitedByIp(ip)).toBe(true);
		expect(limiter.isLimitedByUsername('alice')).toBe(true);
	});

	it('API-AUTH-RATE-02: reset clears IP and username counters', () => {
		const limiter = new EndUserLoginRateLimiterService(config);
		const ip = '1.2.3.4';

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure(ip, 'alice');
		}
		limiter.reset(ip, 'alice');
		expect(limiter.isLimitedByIp(ip)).toBe(false);
		expect(limiter.isLimitedByUsername('alice')).toBe(false);
	});

	it('API-AUTH-RATE-03: 5 username failures → limited by username', () => {
		const limiter = new EndUserLoginRateLimiterService(config);

		for (let i = 0; i < 5; i += 1) {
			limiter.recordFailure('9.9.9.9', 'bob');
		}

		expect(limiter.isLimitedByUsername('bob')).toBe(true);
		expect(limiter.isLimitedByIp('9.9.9.9')).toBe(false);
		expect(limiter.isLimitedByUsername('other-user')).toBe(false);
	});

	it('API-AUTH-RATE-05: expired window allows login again', () => {
		jest.useFakeTimers();
		const limiter = new EndUserLoginRateLimiterService({
			get: (key: string) => {
				if (key === 'END_USER_LOGIN_RATE_LIMIT_MAX') return '2';
				if (key === 'END_USER_LOGIN_RATE_LIMIT_WINDOW_MS') return '1000';
				return undefined;
			},
		} as never);

		limiter.recordFailure('1.2.3.4', 'alice');
		limiter.recordFailure('1.2.3.4', 'alice');
		expect(limiter.isLimitedByIp('1.2.3.4')).toBe(true);

		jest.advanceTimersByTime(1001);
		expect(limiter.isLimitedByIp('1.2.3.4')).toBe(false);
		jest.useRealTimers();
	});

	it('API-AUTH-RATE-04: clear removes all counters', () => {
		const limiter = new EndUserLoginRateLimiterService(config);
		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure('1.2.3.4', 'alice');
		}
		limiter.clear();
		expect(limiter.isLimitedByIp('1.2.3.4')).toBe(false);
		expect(limiter.isLimitedByUsername('alice')).toBe(false);
	});
});
