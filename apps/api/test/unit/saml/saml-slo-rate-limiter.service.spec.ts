import { ConfigService } from '@nestjs/config';
import { SamlSloRateLimiterService } from '@api/saml/services/saml-slo-rate-limiter.service';

function makeLimiter(config: Record<string, string> = {}): SamlSloRateLimiterService {
	const configService = {
		get: (key: string) => config[key],
	} as unknown as ConfigService;
	return new SamlSloRateLimiterService(configService);
}

describe('saml-slo-rate-limiter.service', () => {
	it('API-SLO-RATE-01: over-limit requests trigger the limit', () => {
		const limiter = makeLimiter({ SAML_SLO_RATE_IP_MAX: '3' });
		expect(limiter.hitAndCheck('1.2.3.4')).toBe(false);
		expect(limiter.hitAndCheck('1.2.3.4')).toBe(false);
		expect(limiter.hitAndCheck('1.2.3.4')).toBe(false);
		expect(limiter.hitAndCheck('1.2.3.4')).toBe(true);
	});

	it('separate IPs are counted independently', () => {
		const limiter = makeLimiter({ SAML_SLO_RATE_IP_MAX: '1' });
		expect(limiter.hitAndCheck('a')).toBe(false);
		expect(limiter.hitAndCheck('a')).toBe(true);
		expect(limiter.hitAndCheck('b')).toBe(false);
	});

	it('EDGE: default max (30) applies when unconfigured', () => {
		const limiter = makeLimiter();
		for (let i = 0; i < 30; i += 1) {
			expect(limiter.hitAndCheck('ip')).toBe(false);
		}
		expect(limiter.hitAndCheck('ip')).toBe(true);
	});

	it('EDGE: invalid config values fall back to defaults', () => {
		const limiter = makeLimiter({ SAML_SLO_RATE_IP_MAX: 'abc', SAML_SLO_RATE_WINDOW_MS: '-5' });
		for (let i = 0; i < 30; i += 1) {
			limiter.hitAndCheck('ip');
		}
		expect(limiter.hitAndCheck('ip')).toBe(true);
	});

	it('EDGE: clear() resets all counters', () => {
		const limiter = makeLimiter({ SAML_SLO_RATE_IP_MAX: '1' });
		limiter.hitAndCheck('ip');
		expect(limiter.hitAndCheck('ip')).toBe(true);
		limiter.clear();
		expect(limiter.hitAndCheck('ip')).toBe(false);
	});

	it('API-SLO-RATE-02: counter resets after the window', () => {
		jest.useFakeTimers();
		try {
			const limiter = makeLimiter({ SAML_SLO_RATE_IP_MAX: '2', SAML_SLO_RATE_WINDOW_MS: '1000' });
			expect(limiter.hitAndCheck('x')).toBe(false);
			expect(limiter.hitAndCheck('x')).toBe(false);
			expect(limiter.hitAndCheck('x')).toBe(true);
			jest.advanceTimersByTime(1500);
			expect(limiter.hitAndCheck('x')).toBe(false);
		} finally {
			jest.useRealTimers();
		}
	});
});
