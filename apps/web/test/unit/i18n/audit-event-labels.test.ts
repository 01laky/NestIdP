import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { auditEventLabel } from '@/i18n/audit-event-labels';

const t = ((key: string, opts?: { defaultValue?: string }) => {
	const labels: Record<string, string> = {
		'enums.auditEvent.idp_encryption_cert_generated': 'Encryption certificate generated',
		'enums.auditEvent.idp_encryption_rotation_completed':
			'Encryption certificate rotation completed',
		'enums.auditEvent.saml_request_signature_verified': 'SAML request signature verified',
		'enums.auditEvent.saml_request_decrypted': 'SAML request decrypted',
		'enums.auditEvent.sp_signing_probe_performed': 'SP signing probe performed',
		'enums.auditEvent.idp_want_authn_requests_signed_updated':
			'IdP wantAuthnRequestsSigned updated',
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
		expect(auditEventLabel('saml_request_signature_verified', t)).toBe(
			'SAML request signature verified',
		);
		expect(auditEventLabel('saml_request_decrypted', t)).toBe('SAML request decrypted');
		expect(auditEventLabel('sp_signing_probe_performed', t)).toBe('SP signing probe performed');
		expect(auditEventLabel('idp_want_authn_requests_signed_updated', t)).toBe(
			'IdP wantAuthnRequestsSigned updated',
		);
	});

	it('WEB-AUDIT-ENC-02: unknown audit event falls back to raw id', () => {
		expect(auditEventLabel('custom_unknown_event_xyz', t)).toBe('custom_unknown_event_xyz');
	});
});
