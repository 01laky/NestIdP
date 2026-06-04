# NestIdP

**A deployable SAML Identity Provider you run yourself** — one Docker image, one admin console, identity from your REST API, SAML assertions to your apps.

[![Version](https://img.shields.io/badge/version-1.4.5-blue)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-orange)](package.json)

> Not Okta. Not Keycloak. A focused **SAML 2.0 IdP monolith** (NestJS + React + PostgreSQL/SQLite) for teams that already have users in an internal API and need standards-based SSO to Grafana, custom apps, and other service providers.

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

## Product tour

Screens from a local dev stack. See [docs/tutorial.md](docs/tutorial.md) for the full guided path.

### Dashboard

Counts, last sync status, and IdP metadata/SSO URLs in one place.

![Admin dashboard](docs/img/admin-dashboard.png)

### Operator login

Separate from end-user SAML — operators use `/admin/login`.

![Admin login](docs/img/admin-login.png)

### IdP settings

Entity ID, signing certificate, and SAML metadata for service providers.

![IdP settings overview](docs/img/idp-settings-overview.png)

### API connection and sync

Point at your identity REST API, test connectivity, run full sync (optional dry run).

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

**Prerequisites:** Node.js ≥ 18, pnpm ≥ 9. Docker optional for SQLite dev; recommended for production-like Compose.

### Local dev (SQLite)

```bash
git clone <your-repo-url> NestIdP && cd NestIdP
cp .env.example .env
mkdir -p apps/api/data
pnpm install && pnpm db:migrate && pnpm dev
```

| What           | URL                                                               |
| -------------- | ----------------------------------------------------------------- |
| Admin UI       | http://localhost:5173/admin/login                                 |
| SAML login     | http://localhost:5173/login                                       |
| API / metadata | http://localhost:3000 (Vite proxies `/api` and `/saml` from 5173) |

Bootstrap admin: set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` before first start ([details](docs/database.md#first-admin-bootstrap-v030)).

### Docker (PostgreSQL, production-like)

```bash
cp .env.docker.example .env.docker
# Set SESSION_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD, IDP_BASE_URL
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
| [docs/database.md](docs/database.md)               | SQLite vs PostgreSQL, migrations                   |
| [docs/deployment.md](docs/deployment.md)           | Docker, env, operations                            |
| [docs/RELEASE.md](docs/RELEASE.md)                 | Production go-live checklist                       |
| [docs/README.md](docs/README.md)                   | Full doc index + diagrams                          |

**Diagrams:** `pnpm diagrams:build` · **Screenshots index:** [docs/img/screenshots.md](docs/img/screenshots.md)

---

## Developer commands

| Command           | Description                           |
| ----------------- | ------------------------------------- |
| `pnpm dev`        | Shared package watch + API + Vite web |
| `pnpm dev:docker` | PostgreSQL + hot-reload in Docker     |
| `pnpm build`      | Production build                      |
| `pnpm test`       | Monorepo tests                        |
| `pnpm lint`       | ESLint + TypeScript                   |
| `pnpm db:migrate` | Apply migrations (dev)                |

---

## Tech stack

NestJS · React (Vite) · Prisma · SAML 2.0 (signed assertions) · pnpm workspaces · Docker

---

## Scope and roadmap

v1 is SAML-only (no OIDC/LDAP), single-tenant, one API sync source. Full product boundaries: [docs/proposal.MD](docs/proposal.MD).
