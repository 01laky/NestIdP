# Architecture diagrams

Mermaid sources (`.mmd`) and pre-rendered SVGs for docs. GitHub does not execute Mermaid in all
contexts — **commit updated `.svg` files** whenever you edit `.mmd` sources.

| File                      | Purpose                                                        | Used by                                                               |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `architecture.mmd`        | Monolith: React UI, Nest modules, DB, external API, SP         | [proposal.MD](../proposal.MD) §5, [development.md](../development.md) |
| `connection-types.mmd`    | API connection (inbound sync) vs SP connection (outbound SAML) | [proposal.MD](../proposal.MD) §4                                      |
| `data-flow.mmd`           | High-level sync + assertion delivery                           | [proposal.MD](../proposal.MD) §4                                      |
| `sync-flow.mmd`           | v1 fixed REST sync contract steps                              | [proposal.MD](../proposal.MD) §6.1                                    |
| `sso-flow.mmd`            | SP-initiated SSO sequence                                      | [proposal.MD](../proposal.MD) §6.2                                    |
| `routing.mmd`             | Production URL routing (API vs SAML vs SPA)                    | [development.md](../development.md)                                   |
| `database-providers.mmd`  | `DATABASE_PROVIDER` + `prisma:prepare` workflow                | [database.md](../database.md)                                         |
| `schema-entities.mmd`     | Entity-relationship diagram (11 Prisma models)                 | [database.md](../database.md), [proposal.MD](../proposal.MD) §9       |
| `admin-auth-flow.mmd`     | Operator admin login + session cookie + CSRF sequence          | [database.md](../database.md), [development.md](../development.md)    |
| `api-connection-crud.mmd` | Operator creates API connection → encrypt token → DB           | [development.md](../development.md)                                   |

Regenerate after editing sources:

```bash
pnpm diagrams:build
```

Requires `@mermaid-js/mermaid-cli` (installed on demand via `npx`).

Verify committed SVGs match sources:

```bash
pnpm diagrams:check
```
