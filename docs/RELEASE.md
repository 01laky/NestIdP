# NestIdP v1.0.0 — Production release checklist

Use this checklist before exposing the IdP to end users. Detailed deploy steps: [deployment.md](./deployment.md). Identity API contract: [integration-api.md](./integration-api.md).

---

## Infrastructure

- [ ] TLS terminates in front of IdP; `IDP_BASE_URL` is the public HTTPS URL
- [ ] `TRUST_PROXY=true` when behind a load balancer (single proxy hop)
- [ ] PostgreSQL backups scheduled (`pg_dump` per [deployment.md](./deployment.md))
- [ ] `SESSION_SECRET` and `ENCRYPTION_KEY` generated and stored in a secrets manager (not in git)
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

## Phase 2+ (not required for v1.0.0)

The following remain out of scope for this release:

- Scheduled sync, configurable API field mapping, outbound proxy
- SAMLRequest signature verification, IdP-initiated SSO, SLO
- OIDC, MFA, multi-tenant, multiple identity sources merged

See [proposal.MD §13](./proposal.MD) Phase 2 roadmap.
