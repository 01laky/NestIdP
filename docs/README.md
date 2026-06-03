# NestIdP documentation

Product and developer documentation. Diagram sources live in [`img/`](./img/) (Mermaid `.mmd` + committed `.svg`).

**Current release:** v1.0.0 (Phase 1 MVP complete)

## Core

| Document                                   | Description                                                        |
| ------------------------------------------ | ------------------------------------------------------------------ |
| [proposal.MD](./proposal.MD)               | Product scope, architecture, data model, roadmap (source of truth) |
| [development.md](./development.md)         | Local setup, routing, REST reference, testing                      |
| [database.md](./database.md)               | SQLite vs PostgreSQL, migrations, portable schema                  |
| [integration-api.md](./integration-api.md) | External identity API v1 contract (bcrypt, endpoints)              |
| [deployment.md](./deployment.md)           | Docker Compose, migrations, backup/restore                         |
| [RELEASE.md](./RELEASE.md)                 | Production go-live checklist                                       |

## Diagrams

See [img/README.md](./img/README.md) for the full index. Key figures:

![Architecture overview](./img/architecture.svg)

![API connection vs SP connection](./img/connection-types.svg)

![SP-initiated SSO flow](./img/sso-flow.svg)

![Data model (ER diagram)](./img/schema-entities.svg)

Regenerate: `pnpm diagrams:build` · verify: `pnpm diagrams:check`
