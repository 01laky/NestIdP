# NestIdP documentation

Product and developer documentation. Diagram sources live in [`img/`](./img/) (Mermaid `.mmd` + committed `.svg`).

## Core

| Document                           | Description                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| [proposal.MD](./proposal.MD)       | Product scope, architecture, data model, roadmap (source of truth) |
| [development.md](./development.md) | Local setup, routing, testing, Docker                              |
| [database.md](./database.md)       | SQLite vs PostgreSQL, migrations, portable schema                  |

## Diagrams

See [img/README.md](./img/README.md) for the full index. Key figures:

![Architecture overview](./img/architecture.svg)

![API connection vs SP connection](./img/connection-types.svg)

![SP-initiated SSO flow](./img/sso-flow.svg)

![Data model (ER diagram)](./img/schema-entities.svg)

Regenerate: `pnpm diagrams:build` · verify: `pnpm diagrams:check`
