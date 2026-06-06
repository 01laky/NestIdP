import type { TFunction } from 'i18next';

const KNOWN_AUDIT_EVENTS = new Set([
	'idp_settings_updated',
	'idp_signing_cert_generated',
	'idp_signing_cert_uploaded',
	'idp_signing_rotation_started',
	'idp_signing_rotation_completed',
	'idp_signing_rotation_cancelled',
	'idp_encryption_cert_generated',
	'idp_encryption_cert_uploaded',
	'idp_encryption_rotation_started',
	'idp_encryption_rotation_completed',
	'idp_encryption_rotation_cancelled',
	'idp_want_authn_requests_signed_updated',
	'saml_request_signature_verified',
	'saml_request_decrypted',
	'sp_signing_probe_performed',
	'api_connection_contract_updated',
	'saml_logout_request_received',
	'saml_logout_request_rejected',
	'saml_logout_completed',
	'saml_session_terminated',
	'saml_sso_session_started',
]);

export function auditEventLabel(event: string, t: TFunction): string {
	if (!KNOWN_AUDIT_EVENTS.has(event)) {
		return event;
	}
	return t(`enums.auditEvent.${event}`, { defaultValue: event });
}
