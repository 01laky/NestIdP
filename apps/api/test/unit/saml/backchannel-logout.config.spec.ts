import { ConfigService } from '@nestjs/config';
import { BackchannelLogoutConfig } from '@api/saml/services/backchannel-logout.config';

/**
 * Bounded env config for back-channel (SOAP) SLO (Prompt 36). Each knob clamps to [min, max] and falls
 * back to its default for missing / non-numeric / out-of-range values (mirrors the cert-rotation config).
 */
describe('BackchannelLogoutConfig (bounded env)', () => {
	function make(values: Record<string, unknown>): BackchannelLogoutConfig {
		const stub = { get: (key: string) => values[key] } as unknown as ConfigService;
		return new BackchannelLogoutConfig(stub);
	}

	it('returns documented defaults when nothing is set', () => {
		const c = make({});
		expect(c.schedulerTickMs()).toBe(30_000);
		expect(c.httpTimeoutMs()).toBe(5_000);
		expect(c.maxRetries()).toBe(5);
		expect(c.retryBaseMs()).toBe(30_000);
		expect(c.retryMaxMs()).toBe(3_600_000);
		expect(c.concurrency()).toBe(5);
		expect(c.maxInFlight()).toBe(20);
		expect(c.firstPassBudgetMs()).toBe(4_000);
		expect(c.validitySeconds()).toBe(300);
		expect(c.pruneIntervalMs()).toBe(3_600_000);
		expect(c.pruneRetentionMs()).toBe(7 * 86_400_000);
	});

	it('accepts in-range overrides', () => {
		const c = make({
			SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS: 15_000,
			SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: 10_000,
			SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES: 8,
			SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 12,
			SAML_BACKCHANNEL_LOGOUT_MAX_INFLIGHT: 50,
			SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 120,
		});
		expect(c.schedulerTickMs()).toBe(15_000);
		expect(c.httpTimeoutMs()).toBe(10_000);
		expect(c.maxRetries()).toBe(8);
		expect(c.concurrency()).toBe(12);
		expect(c.maxInFlight()).toBe(50);
		expect(c.validitySeconds()).toBe(120);
	});

	it('parses numeric strings', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: '7' }).concurrency()).toBe(7);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: '2000' }).httpTimeoutMs()).toBe(2000);
	});

	it('falls back to default for non-numeric values', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 'abc' }).concurrency()).toBe(5);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 'NaN' }).validitySeconds()).toBe(300);
	});

	it('clamps below-minimum values back to the default', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: 100 }).httpTimeoutMs()).toBe(5_000);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 0 }).concurrency()).toBe(5);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_MAX_INFLIGHT: 0 }).maxInFlight()).toBe(20);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 10 }).validitySeconds()).toBe(300);
	});

	it('clamps above-maximum values back to the default', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: 999_999 }).httpTimeoutMs()).toBe(5_000);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES: 999 }).maxRetries()).toBe(5);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 1000 }).concurrency()).toBe(5);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 99_999 }).validitySeconds()).toBe(300);
	});

	it('allows 0 for the disable-able knobs (tick / retries / first-pass / prune interval)', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS: 0 }).schedulerTickMs()).toBe(0);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_MAX_RETRIES: 0 }).maxRetries()).toBe(0);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_FIRST_PASS_BUDGET_MS: 0 }).firstPassBudgetMs()).toBe(0);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_PRUNE_INTERVAL_MS: 0 }).pruneIntervalMs()).toBe(0);
	});

	it('honours exact boundary values', () => {
		expect(make({ SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 30 }).validitySeconds()).toBe(30);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_VALIDITY_S: 3_600 }).validitySeconds()).toBe(3_600);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: 1_000 }).httpTimeoutMs()).toBe(1_000);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_HTTP_TIMEOUT_MS: 60_000 }).httpTimeoutMs()).toBe(60_000);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 1 }).concurrency()).toBe(1);
		expect(make({ SAML_BACKCHANNEL_LOGOUT_CONCURRENCY: 100 }).concurrency()).toBe(100);
	});
});
