# NestIdP

**A deployable SAML Identity Provider you run yourself** — one Docker image, one admin console, identity from your REST API, SAML assertions to your apps.

[![Version](https://img.shields.io/badge/version-1.16.0-blue)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-orange)](package.json)

> **SAML 2.0 Identity Provider** (NestJS + React + embedded encrypted libSQL) for teams that already have users in an internal API and need standards-based SSO to Grafana, custom apps, and other service providers.

---

## What you get

|                                |                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| **Admin console** (`/admin`)   | Configure identity sources, SP connections, IdP certificates, and browse synced users |
| **SAML login** (`/login`)      | Branded end-user sign-in during SP-initiated SSO                                      |
| **SAML endpoints** (`/saml/*`) | Metadata, HTTP-Redirect SSO, signed assertions (HTTP-POST to SP ACS)                  |
| **Identity sync**              | Pull users, groups, roles, and bcrypt password hashes from a REST API                 |
| **Single deployable unit**     | Monorepo → one production image; no microservices                                     |

**Operator walkthrough with screenshots:** [docs/tutorial.md](docs/tutorial.md)

---

## How it fits together

Two connection types — never mixed:

![API connection pulls identity in; SP connection sends SAML out](docs/img/connection-types.svg)

| Connection         | Direction          | Purpose                                        |
| ------------------ | ------------------ | ---------------------------------------------- |
| **API connection** | External API → IdP | Sync users, groups, roles, password hashes     |
| **SP connection**  | IdP → application  | SAML 2.0 login to Grafana, SaaS, or custom SPs |

SP-initiated SSO (typical flow):

![SP-initiated SSO sequence](docs/img/sso-flow.svg)

Architecture overview: [docs/img/architecture.svg](docs/img/architecture.svg) · Full spec: [docs/proposal.MD](docs/proposal.MD)

---

## Certificates and SAML encryption

NestIdP separates **three** kinds of X.509 material. They must not be mixed up when configuring production SSO.

![Signing certificate, encryption certificate, and metadata on IdP settings](docs/img/idp-settings-signing-and-encryption.png)

| Certificate        | Where configured                        | Role                                                                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IdP signing**    | IdP settings → Signing certificate      | Signs SAML assertions and IdP metadata. Required for real SSO. Generate in admin (RSA or EC, eight XML-DSig algorithms, expiry up to 10 years) or upload PEM. Supports **dual-cert rotation** (old + new keys in metadata until cutover), **manual or automatic** (opt-in scheduler that rotates before expiry). |
| **IdP encryption** | IdP settings → Encryption certificate   | Optional second key pair published as `KeyDescriptor use="encryption"` in metadata. Independent lifecycle from signing: RSA or EC, RSA-OAEP key-transport catalog, generate/upload/rotation, copy or download public PEM. **Does not** encrypt assertions to a specific SP by itself.                            |
| **SP certificate** | Each SP connection → SP certificate PEM | That application’s public key. Required when **Encrypt SAML assertions** is enabled — the IdP encrypts the signed assertion to this SP (AES-256-CBC + RSA-OAEP key transport). Distinct from the IdP encryption cert in metadata.                                                                                |

**Assertion content encryption (when enabled):** fixed **AES-256-CBC** for SAML XML Encryption in v1. **Key transport** toward the SP uses the SP’s certificate, not the IdP encryption cert.

**IdP encryption cert options** (generate panel): key type, EC curve or RSA modulus, key-transport algorithm, expiry, **Copy signing options**, and warnings when EC keys may not be accepted by all SPs.

![Encryption certificate options — key type, transport algorithm, generate and upload](docs/img/idp-settings-encryption-cert-options.png)

Diagram of how the three certificates relate: [docs/img/idp-certificates.svg](docs/img/idp-certificates.svg). Operator steps: [docs/tutorial.md#3-idp-settings-global-saml-idp](docs/tutorial.md#3-idp-settings-global-saml-idp).

---

## Product tour

Screens from a local dev stack. See [docs/tutorial.md](docs/tutorial.md) for the full guided path.

### Dashboard

Counts, last sync status, and IdP metadata/SSO URLs in one place.

![Admin dashboard](docs/img/admin-dashboard.png)

### Operator login

Separate from end-user SAML — operators use `/admin/login`.

![Admin login](docs/img/admin-login.png)

### IdP settings

Entity ID, **signing** and **encryption** certificates (separate panels), metadata preview, and SAML URLs for service providers.

![IdP settings overview](docs/img/idp-settings-overview.png)

![Signing and encryption certificates on one page](docs/img/idp-settings-signing-and-encryption.png)

![Encryption certificate — generate options and key transport](docs/img/idp-settings-encryption-cert-options.png)

### API connection and sync

Point at your identity REST API, test connectivity, run full sync (optional dry run). Optionally
schedule automatic syncs (cron) or route a connection's outbound traffic through a corporate HTTP/HTTPS
proxy (per connection, off by default).

![Edit API connection](docs/img/api-connection-edit.png)

![Run identity sync](docs/img/api-connection-sync.png)

### Identity directory

Users, groups, and roles after sync — paginated lists, manual records in local directory.

![Users list](docs/img/identity-users-list.png)

### SP connections

Register SAML apps (example: Grafana Cloud) with Entity ID, ACS URL, and attribute mapping.

![SP connections list](docs/img/sp-connections-list.png)

### SAML login

End users authenticate here when redirected from a service provider.

![SAML login page](docs/img/saml-login.png)

---

## Quick start

**Prerequisites:** Node.js ≥ 18, pnpm ≥ 9. No database server needed — the datastore is an embedded encrypted libSQL file. Docker is optional for dev, recommended for production-like Compose.

### Local dev

```bash
git clone <your-repo-url> NestIdP && cd NestIdP
cp .env.example .env
mkdir -p apps/api/data
pnpm install && pnpm db:migrate:deploy && pnpm dev
```

| What           | URL                                                               |
| -------------- | ----------------------------------------------------------------- |
| Admin UI       | http://localhost:5173/admin/login                                 |
| SAML login     | http://localhost:5173/login                                       |
| API / metadata | http://localhost:3000 (Vite proxies `/api` and `/saml` from 5173) |

Bootstrap admin: set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` before first start ([details](docs/database.md#first-admin-bootstrap-v030)).

### Docker (production-like)

```bash
cp .env.docker.example .env.docker
# Set SESSION_SECRET, ENCRYPTION_KEY, DATABASE_ENCRYPTION_KEY, ADMIN_PASSWORD, IDP_BASE_URL
pnpm dev:docker
# or: docker compose -f docker-compose.dev.yml up
```

Open http://localhost:5173 — same paths as above. See [docs/deployment.md](docs/deployment.md).

### Try sync with the mock API

```bash
cd mock-app && pnpm install && pnpm start   # http://localhost:4010
```

In admin: API connection → base URL `http://localhost:4010`, bearer `mock-sync-dev-token` → **Run full sync** → sign in on `/login` as `user001` / `MockPass123!`.

---

## Documentation

| Guide                                              | For                                                |
| -------------------------------------------------- | -------------------------------------------------- |
| [docs/tutorial.md](docs/tutorial.md)               | First-time operators — UI screenshots step by step |
| [docs/development.md](docs/development.md)         | Routing, REST API, tests, Evergreen UI             |
| [docs/integration-api.md](docs/integration-api.md) | External identity API contract (v1)                |
| [docs/database.md](docs/database.md)               | Encrypted libSQL file, migrations, rekey/backup    |
| [docs/deployment.md](docs/deployment.md)           | Docker, env, operations                            |
| [docs/RELEASE.md](docs/RELEASE.md)                 | Production go-live checklist                       |
| [docs/README.md](docs/README.md)                   | Full doc index + diagrams                          |

**Diagrams:** `pnpm diagrams:build` · **Screenshots index:** [docs/img/screenshots.md](docs/img/screenshots.md)

---

## Developer commands

| Command                  | Description                           |
| ------------------------ | ------------------------------------- |
| `pnpm dev`               | Shared package watch + API + Vite web |
| `pnpm dev:docker`        | Hot-reload stack in Docker            |
| `pnpm build`             | Production build                      |
| `pnpm test`              | Monorepo tests                        |
| `pnpm lint`              | ESLint + TypeScript                   |
| `pnpm db:migrate:deploy` | Apply pending migrations              |
| `pnpm db:new-migration`  | Author a new migration                |

---

## Tech stack

NestJS · React (Vite) · Prisma + encrypted libSQL · SAML 2.0 (signed assertions) · pnpm workspaces · Docker

---

## Scope and roadmap

v1 is SAML-only (no OIDC/LDAP), single-tenant, one API sync source. Full product boundaries: [docs/proposal.MD](docs/proposal.MD).
