# NestIdP — Production release checklist

Use this checklist before exposing the IdP to end users. Detailed deploy steps: [deployment.md](./deployment.md). Compose files and env templates: [`deploy/`](../deploy/README.md). Identity API contract: [integration-api.md](./integration-api.md).

---

## Infrastructure

- [ ] `deploy/.env.docker.prod` created from `deploy/.env.docker.prod.example` with all secrets replaced
- [ ] TLS terminates in front of IdP; `IDP_BASE_URL` is the public HTTPS URL (set in `deploy/.env.docker.prod`)
- [ ] `TRUST_PROXY=true` when behind a load balancer (single proxy hop)
- [ ] DB file on a persistent volume; encrypted backups scheduled (`pnpm db:backup` per [deployment.md](./deployment.md))
- [ ] `SESSION_SECRET`, `ENCRYPTION_KEY`, and `DATABASE_ENCRYPTION_KEY` generated and stored in a secrets manager (not in git)
- [ ] `DATABASE_ENCRYPTION_KEY` set (required in production) and backed up — loss makes the DB file unreadable
- [ ] `ENCRYPTION_KEY` backup stored securely (loss requires re-entering API tokens and re-uploading IdP keys)

---

## IdP configuration

- [ ] IdP signing certificate configured (not relying on lazy auto-generate in production)
- [ ] Entity ID matches SP expectations; metadata URL reachable by SPs (`{IDP_BASE_URL}/saml/metadata`)
- [ ] Certificate rotation procedure understood (dual-cert in metadata during rotation)

---

## Identity source

- [ ] API connection `baseUrl` reachable from the container network
- [ ] External API returns bcrypt `passwordHash` per [integration-api.md](./integration-api.md)
- [ ] First sync completed; test user can log in at `/login` (inactive users blocked)

---

## SAML applications

- [ ] SP connection ACS URL uses HTTPS in production
- [ ] Attribute mapping verified against SP requirements
- [ ] Test SSO wizard succeeded for each SP
- [ ] Real SP metadata updated with IdP metadata URL

---

## Security and operations

- [ ] Default bootstrap password changed; second admin account created at `/admin/settings/admins`
- [ ] Audit log reviewed at `/admin/audit`; `AUDIT_RETENTION_DAYS` appropriate for policy
- [ ] Review recent audit events after cutover
- [ ] Rate limits understood (admin login, end-user login, admin-user create)

---

## Post-go-live

- [ ] Monitor `/health` and `/ready` from the load balancer
- [ ] Document on-call: how to read **SyncLog** (sync UI), **AuditEvent** (`/admin/audit`), and container stdout (dual-write audit)

---

## Monitoring checklist

Verify these operational endpoints are reachable from your load balancer or monitoring system:

| Endpoint      | Expected | Meaning                                             |
| ------------- | -------- | --------------------------------------------------- |
| `GET /health` | `200`    | Process alive; includes `version`, `gitSha`, uptime |
| `GET /ready`  | `200`    | DB connected, migrations applied (`upToDate: true`) |

Useful `/health` response fields to alert on:

| Field                                | Action when non-zero / non-null                               |
| ------------------------------------ | ------------------------------------------------------------- |
| `audit.persistFailures`              | Audit rows failing to persist — investigate DB connectivity   |
| `schedulers.sync.lastTickAt`         | `null` after > 2× `SYNC_SCHEDULER_TICK_MS` → scheduler hung   |
| `schedulers.certRotation.lastTickAt` | `null` after > 2× `CERT_ROTATION_SCHEDULER_TICK_MS`           |
| `schedulers.backchannel.lastTickAt`  | `null` after > 2× `SAML_BACKCHANNEL_LOGOUT_SCHEDULER_TICK_MS` |

Recommended alerts:

- [ ] `/ready` returns non-200 for > 30 s → trigger PagerDuty / Slack alert
- [ ] `audit.persistFailures` increases → notify on-call
- [ ] Container restart detected (uptime counter resets)
- [ ] Scheduler `lastTickAt` older than 2× tick interval
