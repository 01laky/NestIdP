# Audit events

Every **persisted** audit row's `event` name comes from the single registry
`apps/api/src/audit/audit-event-names.ts` (§15). `AuditRecordInput.event` is typed against the
registry union, so an event string cannot be built outside it — adding an event means adding it to
the registry first. The `AUDIT-REG-*` tests additionally enforce the naming scheme and reject dead
registry entries.

## Naming scheme

- `snake_case`, lowercase `a–z0–9` segments joined by `_`
  (regex: `^[a-z0-9]+(_[a-z0-9]+)*$`).
- Segment order: `<subject>_<action>[_<qualifier>]` — e.g. `sp_connection_created`,
  `sync_scheduled_run_skipped`. Per-kind segments sit **inside the subject**:
  `idp_signing_auto_rotation_started`, never `idp_signing_rotation_auto_started`.
- Structured stdout-only log lines (`logger.log(JSON.stringify({ event: … }))`, e.g.
  `cert_rotation_tick_failed`, `backchannel_logout_sent`) are **not** audit rows and are not in the
  registry, but the same scheme regex is enforced on them by `AUDIT-REG-04`.

### Renames in v1.18.1 (§15 offender fixes)

Historical rows keep the old names; new rows use the new ones. Update SIEM rules accordingly.

| Old (≤ 1.18.0)                          | New (1.18.1+)                          |
| --------------------------------------- | -------------------------------------- |
| `identity.user.created` (dotted family) | `identity_user_created` (whole family) |
| `identity_db_test` (on **connect**)     | `identity_db_connected`                |
| `idp_<kind>_rotation_auto_started`      | `idp_<kind>_auto_rotation_started`     |
| `idp_<kind>_rotation_auto_completed`    | `idp_<kind>_auto_rotation_completed`   |

## Event catalogue

Categories are the Prisma `AuditCategory` enum; actor types the `AuditActorType` enum.

### `admin_auth` — operator authentication

| Event                      | Actor  | When                                      |
| -------------------------- | ------ | ----------------------------------------- |
| `admin_login_success`      | admin  | Admin login succeeded                     |
| `admin_login_failure`      | admin  | Admin login failed (bad credentials)      |
| `admin_login_locked`       | system | Admin account locked by repeated failures |
| `admin_login_rate_limited` | system | Admin login throttled                     |
| `admin_account_unlocked`   | system | Admin lockout expired/cleared             |
| `admin_logout`             | admin  | Admin logout (CSRF-checked)               |
| `admin_password_changed`   | admin  | Admin changed their own password          |

### `admin_config` — operator configuration

| Event                                                       | Actor         | When                                                                                                |
| ----------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `admin_user_bootstrapped`                                   | system        | Initial admin created at first boot                                                                 |
| `admin_user_created` / `_updated` / `_deleted`              | admin         | Admin-user CRUD                                                                                     |
| `admin_user_create_rate_limited`                            | admin         | Admin-user creation throttled                                                                       |
| `idp_settings_updated`                                      | admin         | IdP settings saved                                                                                  |
| `idp_signing_key_generated`                                 | system        | Signing material auto-provisioned on first use                                                      |
| `idp_signing_cert_generated` / `_uploaded`                  | admin         | Primary signing cert generated/uploaded                                                             |
| `idp_encryption_cert_generated` / `_uploaded`               | admin         | Primary encryption cert generated/uploaded                                                          |
| `idp_<kind>_rotation_started` / `_completed` / `_cancelled` | admin         | Manual rotation lifecycle (`kind` ∈ signing, encryption)                                            |
| `idp_<kind>_auto_rotation_started` / `_completed`           | system        | Auto-rotation driver started/promoted a rotation                                                    |
| `idp_<kind>_auto_rotation_due_soon`                         | system        | Cert entered the notify window                                                                      |
| `idp_<kind>_auto_rotation_failed` / `_autodisabled`         | system        | Auto-rotation failure / failure-backoff disable                                                     |
| `idp_<kind>_cert_unparseable`                               | system        | Active cert PEM unparseable — auto-rotation cannot evaluate it (deduped: once per process per cert) |
| `idp_auto_rotation_deferred_boot`                           | system        | Due rotation deferred on the boot tick (outside boot grace)                                         |
| `idp_auto_rotation_setting_changed`                         | admin         | Auto-rotation toggled                                                                               |
| `idp_auto_rotation_check_run`                               | admin\|system | On-demand vs scheduled rotation check                                                               |
| `sp_connection_created` / `_updated` / `_deleted`           | admin         | SP connection CRUD                                                                                  |
| `sp_connection_acs_tested`                                  | admin         | Test-ACS probe run                                                                                  |
| `sp_signing_probe_performed`                                | admin         | SP signing probe run                                                                                |

### `end_user_auth` — end-user authentication

| Event                                        | Actor    | When                                          |
| -------------------------------------------- | -------- | --------------------------------------------- |
| `end_user_login_success` / `_failure`        | end_user | End-user login outcome                        |
| `end_user_login_locked`                      | system   | End-user account locked                       |
| `end_user_login_rate_limited`                | system   | End-user login throttled                      |
| `end_user_account_unlocked`                  | system   | End-user lockout expired/cleared              |
| `end_user_logout`                            | end_user | End-user logout                               |
| `end_user_saml_bind_failure`                 | end_user | Correct password but SAML-session bind failed |
| `end_user_sso_complete_success` / `_failure` | end_user | SSO completion outcome                        |
| `end_user_unsupported_hash_algorithm`        | end_user | Stored hash algorithm unsupported at login    |
| `login_ip_banned`                            | system   | IP banned after repeated failures             |
| `saml_sso_rate_limited`                      | system   | Public SAML SSO endpoint throttled            |

### `saml` — protocol events

| Event                                                                                             | Actor    | When                                               |
| ------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| `saml_request_received` / `_rejected` / `_decrypted`                                              | system   | AuthnRequest intake pipeline                       |
| `saml_request_signature_verified`                                                                 | system   | AuthnRequest signature verified                    |
| `saml_response_issued` / `_failed`                                                                | system   | Assertion delivery outcome                         |
| `saml_sso_session_started`                                                                        | end_user | IdP SSO session established                        |
| `saml_session_terminated`                                                                         | varies   | SSO session ended (logout/admin kill/user delete…) |
| `saml_logout_request_received` / `_rejected`                                                      | system   | SP-initiated SLO intake                            |
| `saml_logout_completed`                                                                           | system   | SLO response built + signed                        |
| `saml_backchannel_logout_skipped` / `_sent` / `_succeeded` / `_partial` / `_failed` / `_given_up` | system   | Back-channel SLO delivery state machine            |

### `sync` — identity synchronisation

| Event                                                                                          | Actor         | When                                       |
| ---------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------ |
| `api_connection_created` / `_updated` / `_deleted` / `_tested`                                 | admin         | API connection CRUD/test                   |
| `api_connection_auth_type_changed` / `_contract_updated` / `_proxy_updated` / `_proxy_checked` | admin         | Connection sub-config changes              |
| `api_connection_oauth_token_obtained` / `_failed`                                              | system        | OAuth client-credentials exchange          |
| `identity_source_identities_removed`                                                           | admin         | Source removal wiped its synced identities |
| `sync_completed` / `sync_failed` / `sync_in_progress`                                          | admin\|system | Sync run outcome (manual or scheduled)     |
| `sync_schedule_updated` / `_auto_paused`                                                       | admin\|system | Schedule config / failure auto-pause       |
| `sync_scheduled_run_started` / `_skipped` / `_failed`                                          | system        | Scheduler per-run lifecycle                |
| `sync_scheduler_started` / `_disabled` / `_boot_failed` / `_connection_error`                  | system        | Scheduler lifecycle                        |
| `identity_sync_all_triggered`                                                                  | admin         | "Sync all sources" triggered               |
| `identity_sync_username_collision`                                                             | system        | Cross-source username collision handled    |

### `identity` — manual CRUD + external database

| Event                                              | Actor | When                                     |
| -------------------------------------------------- | ----- | ---------------------------------------- |
| `identity_user_created` / `_updated` / `_deleted`  | admin | Manual user CRUD                         |
| `identity_group_created` / `_updated` / `_deleted` | admin | Manual group CRUD                        |
| `identity_role_created` / `_updated` / `_deleted`  | admin | Manual role CRUD                         |
| `identity_db_connected`                            | admin | External identity DB connected           |
| `identity_db_cutover` / `identity_db_local_wiped`  | admin | Cutover to external store (± local wipe) |
| `identity_db_resynced`                             | admin | External DB resynced from local          |
| `identity_db_disconnected`                         | admin | External DB disconnected (back to local) |

> Test connections (`POST external-db/test`) are deliberately **not** audited — they make no state
> change; the connect/cutover/resync/disconnect lifecycle is.
