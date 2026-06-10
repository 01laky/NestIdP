/**
 * §15 audit-event registry — the single source of truth for every event name a persisted audit row
 * can carry.
 *
 * Naming scheme (enforced by AUDIT-REG-* tests): `snake_case`, segments ordered
 * `<subject>_<action>[_<qualifier>]` (e.g. `sp_connection_created`, `idp_signing_auto_rotation_started`
 * — the per-kind segment sits inside the subject). Lowercase a–z/0–9 only, `_`-separated.
 *
 * `AuditRecordInput.event` is typed against this union, so a new event name MUST be added here first
 * — the compiler rejects any literal built outside the registry. Structured stdout-only log lines
 * (`logger.log(JSON.stringify({ event: ... }))`) are NOT audit rows and are not listed here, but the
 * registry test still holds them to the same naming scheme.
 *
 * docs/audit-events.md documents every entry with its category + actorType.
 */
export const AUDIT_EVENT_NAMES = [
	// admin_auth
	'admin_login_success',
	'admin_login_failure',
	'admin_login_locked',
	'admin_account_unlocked',
	'admin_logout',
	'admin_password_changed',

	// admin_config — admin users
	'admin_user_bootstrapped',
	'admin_user_created',
	'admin_user_updated',
	'admin_user_deleted',
	'admin_user_create_rate_limited',

	// admin_config — IdP settings + certificates
	'idp_settings_updated',
	'idp_signing_key_generated',
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
	'idp_signing_auto_rotation_started',
	'idp_signing_auto_rotation_completed',
	'idp_signing_auto_rotation_due_soon',
	'idp_signing_auto_rotation_failed',
	'idp_signing_auto_rotation_autodisabled',
	'idp_encryption_auto_rotation_started',
	'idp_encryption_auto_rotation_completed',
	'idp_encryption_auto_rotation_due_soon',
	'idp_encryption_auto_rotation_failed',
	'idp_encryption_auto_rotation_autodisabled',
	'idp_auto_rotation_setting_changed',
	'idp_auto_rotation_check_run',

	// admin_config — SP connections
	'sp_connection_created',
	'sp_connection_updated',
	'sp_connection_deleted',
	'sp_connection_acs_tested',
	'sp_signing_probe_performed',

	// end_user_auth
	'end_user_login_success',
	'end_user_login_failure',
	'end_user_login_locked',
	'end_user_account_unlocked',
	'end_user_logout',
	'end_user_saml_bind_failure',
	'end_user_sso_complete_success',
	'end_user_sso_complete_failure',
	'end_user_unsupported_hash_algorithm',
	'login_ip_banned',
	'admin_login_rate_limited',
	'end_user_login_rate_limited',
	'saml_sso_rate_limited',

	// saml
	'saml_request_received',
	'saml_request_rejected',
	'saml_request_decrypted',
	'saml_request_signature_verified',
	'saml_response_issued',
	'saml_response_failed',
	'saml_sso_session_started',
	'saml_session_terminated',
	'saml_logout_request_received',
	'saml_logout_request_rejected',
	'saml_logout_completed',
	'saml_backchannel_logout_skipped',
	'saml_backchannel_logout_sent',
	'saml_backchannel_logout_succeeded',
	'saml_backchannel_logout_partial',
	'saml_backchannel_logout_failed',
	'saml_backchannel_logout_given_up',

	// sync — API connections
	'api_connection_created',
	'api_connection_updated',
	'api_connection_deleted',
	'api_connection_tested',
	'api_connection_auth_type_changed',
	'api_connection_contract_updated',
	'api_connection_proxy_updated',
	'api_connection_proxy_checked',
	'api_connection_oauth_token_obtained',
	'api_connection_oauth_token_failed',
	'identity_source_identities_removed',

	// sync — runs + schedule
	'sync_completed',
	'sync_failed',
	'sync_in_progress',
	'sync_schedule_updated',
	'sync_schedule_auto_paused',
	'sync_scheduled_run_started',
	'sync_scheduled_run_skipped',
	'sync_scheduled_run_failed',
	'sync_scheduler_started',
	'sync_scheduler_disabled',
	'sync_scheduler_boot_failed',
	'sync_scheduler_connection_error',
	'identity_sync_all_triggered',
	'identity_sync_username_collision',

	// identity — manual CRUD (renamed in §15 from the legacy dot-separated family)
	'identity_user_created',
	'identity_user_updated',
	'identity_user_deleted',
	'identity_group_created',
	'identity_group_updated',
	'identity_group_deleted',
	'identity_role_created',
	'identity_role_updated',
	'identity_role_deleted',

	// identity — external database lifecycle (the connect path previously mis-emitted
	// `identity_db_test`; renamed to `identity_db_connected` in §15 — test connections are not audited)
	'identity_db_connected',
	'identity_db_cutover',
	'identity_db_local_wiped',
	'identity_db_resynced',
	'identity_db_disconnected',
] as const;

export type AuditEventName = (typeof AUDIT_EVENT_NAMES)[number];

/** §15 naming scheme: snake_case, `<subject>_<action>[_<qualifier>]`. */
export const AUDIT_EVENT_NAME_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

const NAME_SET: ReadonlySet<string> = new Set(AUDIT_EVENT_NAMES);

export function isAuditEventName(value: string): value is AuditEventName {
	return NAME_SET.has(value);
}
