import { LoginRateLimiterService } from '@api/admin-auth/services/login-rate-limiter.service';

describe('LoginRateLimiterService', () => {
	it('API-AUTH-RL-01: 10 failed attempts → 11th returns limited', () => {
		const limiter = new LoginRateLimiterService();
		const ip = '1.2.3.4';

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure(ip);
		}

		expect(limiter.isLimited(ip)).toBe(true);
	});

	it('API-AUTH-RL-02: successful login resets counter', () => {
		const limiter = new LoginRateLimiterService();
		const ip = '1.2.3.4';

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure(ip);
		}
		limiter.reset(ip);
		expect(limiter.isLimited(ip)).toBe(false);
	});

	it('API-AUTH-RL-03: different IPs have independent counters', () => {
		const limiter = new LoginRateLimiterService();

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure('1.1.1.1');
		}

		expect(limiter.isLimited('1.1.1.1')).toBe(true);
		expect(limiter.isLimited('2.2.2.2')).toBe(false);
	});

	it('API-AUTH-RL-04: counter resets after window expires', () => {
		jest.useFakeTimers();
		const limiter = new LoginRateLimiterService();
		const ip = '9.9.9.9';

		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure(ip);
		}
		expect(limiter.isLimited(ip)).toBe(true);

		jest.advanceTimersByTime(15 * 60 * 1000 + 1);
		expect(limiter.isLimited(ip)).toBe(false);

		jest.useRealTimers();
	});

	it('API-AUTH-RL-05: clear removes all counters', () => {
		const limiter = new LoginRateLimiterService();
		for (let i = 0; i < 10; i += 1) {
			limiter.recordFailure('1.2.3.4');
		}
		limiter.clear();
		expect(limiter.isLimited('1.2.3.4')).toBe(false);
	});
});
