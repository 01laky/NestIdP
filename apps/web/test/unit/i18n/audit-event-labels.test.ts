import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { auditEventLabel } from '@/i18n/audit-event-labels';

const t = ((key: string, opts?: { defaultValue?: string }) => {
	const labels: Record<string, string> = {
		'enums.auditEvent.idp_encryption_cert_generated': 'Encryption certificate generated',
		'enums.auditEvent.idp_encryption_rotation_completed':
			'Encryption certificate rotation completed',
	};
	return labels[key] ?? opts?.defaultValue ?? key;
}) as TFunction;

describe('auditEventLabel', () => {
	it('WEB-AUDIT-ENC-01: known encryption audit events return i18n keys', () => {
		expect(auditEventLabel('idp_encryption_cert_generated', t)).toBe(
			'Encryption certificate generated',
		);
		expect(auditEventLabel('idp_encryption_rotation_completed', t)).toBe(
			'Encryption certificate rotation completed',
		);
	});

	it('WEB-AUDIT-ENC-02: unknown audit event falls back to raw id', () => {
		expect(auditEventLabel('custom_unknown_event_xyz', t)).toBe('custom_unknown_event_xyz');
	});
});
