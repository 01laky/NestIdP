import { ConfigService } from '@nestjs/config';
import { CertRotationConfig } from '@api/idp-settings/cert-rotation.config';

function configWith(env: Record<string, string | number | boolean>): CertRotationConfig {
	const svc = {
		get: jest.fn((key: string) => env[key]),
	} as unknown as ConfigService;
	return new CertRotationConfig(svc);
}

describe('CertRotationConfig (Prompt 34)', () => {
	it('CERT-ROT-CFG-01: defaults when unset', () => {
		const c = configWith({});
		expect(c.tickMs()).toBe(3_600_000);
		expect(c.leadDays('signing')).toBe(30);
		expect(c.overlapDays('encryption')).toBe(7);
		expect(c.validityDays()).toBe(365);
		expect(c.notifyLeadDays()).toBe(45);
		expect(c.jitterMaxSeconds()).toBe(0);
		expect(c.bootGraceHours()).toBe(0);
		expect(c.failureAutodisableThreshold()).toBe(5);
		expect(c.dryRun()).toBe(false);
	});

	it('CERT-ROT-CFG-02: tickMs 0 disables; out-of-range falls back to default', () => {
		expect(configWith({ CERT_ROTATION_SCHEDULER_TICK_MS: 0 }).tickMs()).toBe(0);
		expect(configWith({ CERT_ROTATION_SCHEDULER_TICK_MS: -5 }).tickMs()).toBe(3_600_000);
		expect(configWith({ CERT_ROTATION_SCHEDULER_TICK_MS: 999_999_999 }).tickMs()).toBe(3_600_000);
	});

	it('CERT-ROT-CFG-03: per-cert lead/overlap overrides win over the shared value', () => {
		const c = configWith({
			CERT_ROTATION_LEAD_DAYS: 20,
			CERT_ROTATION_SIGNING_LEAD_DAYS: 10,
			CERT_ROTATION_OVERLAP_DAYS: 5,
			CERT_ROTATION_ENCRYPTION_OVERLAP_DAYS: 14,
		});
		expect(c.leadDays('signing')).toBe(10);
		expect(c.leadDays('encryption')).toBe(20); // falls back to shared
		expect(c.overlapDays('encryption')).toBe(14);
		expect(c.overlapDays('signing')).toBe(5); // shared
	});

	it('CERT-ROT-CFG-04: invalid per-cert override is ignored (falls back to shared)', () => {
		const c = configWith({ CERT_ROTATION_LEAD_DAYS: 25, CERT_ROTATION_SIGNING_LEAD_DAYS: 9999 });
		expect(c.leadDays('signing')).toBe(25);
	});

	it('CERT-ROT-CFG-05: dryRun parses string + boolean truthy forms', () => {
		expect(configWith({ CERT_ROTATION_DRY_RUN: true }).dryRun()).toBe(true);
		expect(configWith({ CERT_ROTATION_DRY_RUN: 'true' }).dryRun()).toBe(true);
		expect(configWith({ CERT_ROTATION_DRY_RUN: '1' }).dryRun()).toBe(true);
		expect(configWith({ CERT_ROTATION_DRY_RUN: 'false' }).dryRun()).toBe(false);
		expect(configWith({ CERT_ROTATION_DRY_RUN: '0' }).dryRun()).toBe(false);
	});

	it('CERT-ROT-CFG-06: threshold 0 means never auto-disable', () => {
		expect(
			configWith({ CERT_ROTATION_FAILURE_AUTODISABLE_THRESHOLD: 0 }).failureAutodisableThreshold(),
		).toBe(0);
	});
});
