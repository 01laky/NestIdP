import { ConfigService } from '@nestjs/config';
import { RateLimitConfig } from '@api/auth-protection/rate-limit.config';

function configWith(env: Record<string, string | number | boolean>): RateLimitConfig {
	return new RateLimitConfig({
		get: jest.fn((key: string) => env[key]),
	} as unknown as ConfigService);
}

describe('RateLimitConfig (Prompt 35)', () => {
	it('RL-CFG-01: defaults when unset', () => {
		const c = configWith({});
		expect(c.lockoutThreshold('admin')).toBe(5);
		expect(c.lockoutThreshold('end_user')).toBe(5);
		expect(c.lockoutBaseMs('admin')).toBe(900_000);
		expect(c.lockoutMaxMs('admin')).toBe(86_400_000);
		expect(c.adminIpMax()).toBe(10);
		expect(c.adminUsernameMax()).toBe(5);
		expect(c.endUserIpMax()).toBe(10);
		expect(c.ssoIpMax()).toBe(60);
		expect(c.ipBanThreshold()).toBe(10);
		expect(c.responseMode()).toBe('retry_after');
		expect(c.tarpitBaseMs()).toBe(0);
		expect(c.trustedCidrs()).toEqual([]);
	});

	it('RL-CFG-02: per-scope lockout override wins over the shared value', () => {
		const c = configWith({ LOGIN_LOCKOUT_THRESHOLD: 5, ADMIN_LOGIN_LOCKOUT_THRESHOLD: 3 });
		expect(c.lockoutThreshold('admin')).toBe(3);
		expect(c.lockoutThreshold('end_user')).toBe(5);
	});

	it('RL-CFG-03: threshold 0 disables a layer; out-of-range falls back to default', () => {
		expect(configWith({ LOGIN_LOCKOUT_THRESHOLD: 0 }).lockoutThreshold('admin')).toBe(0);
		expect(configWith({ LOGIN_IP_BAN_THRESHOLD: 0 }).ipBanThreshold()).toBe(0);
		expect(configWith({ ADMIN_LOGIN_RATE_LIMIT_MAX: -1 }).adminIpMax()).toBe(10);
	});

	it('RL-CFG-04: responseMode parses opaque, defaults to retry_after otherwise', () => {
		expect(configWith({ LOGIN_LOCKOUT_RESPONSE_MODE: 'opaque' }).responseMode()).toBe('opaque');
		expect(configWith({ LOGIN_LOCKOUT_RESPONSE_MODE: 'OPAQUE' }).responseMode()).toBe('opaque');
		expect(configWith({ LOGIN_LOCKOUT_RESPONSE_MODE: 'anything' }).responseMode()).toBe(
			'retry_after',
		);
	});

	it('RL-CFG-05: trustedCidrs parses a comma/space list', () => {
		const c = configWith({ RATE_LIMIT_TRUSTED_CIDRS: '10.0.0.0/8, 127.0.0.1 192.168.1.0/24' });
		expect(c.trustedCidrs()).toEqual(['10.0.0.0/8', '127.0.0.1', '192.168.1.0/24']);
	});

	it('RL-CFG-06: tarpit base is bounded (rejects > 5000)', () => {
		expect(configWith({ LOGIN_TARPIT_BASE_MS: 250 }).tarpitBaseMs()).toBe(250);
		expect(configWith({ LOGIN_TARPIT_BASE_MS: 999_999 }).tarpitBaseMs()).toBe(0);
	});
});
