# Docs images

## UI screenshots

Operator and login UI captures (`.png`) — index in [screenshots.md](./screenshots.md), full walkthrough in [tutorial.md](../tutorial.md).

| File                                    | Screen                                   |
| --------------------------------------- | ---------------------------------------- |
| `admin-login.png`                       | Operator login                           |
| `admin-dashboard.png`                   | Dashboard                                |
| `idp-settings-overview.png`             | IdP settings — URLs and entity ID        |
| `idp-settings-certificate-metadata.png` | IdP settings — cert and metadata preview |
| `idp-settings-upload-certificate.png`   | IdP settings — upload PEM                |
| `api-connection-edit.png`               | Edit API connection                      |
| `api-connection-sync.png`               | Sync page                                |
| `identity-users-list.png`               | Users list                               |
| `identity-groups-list.png`              | Groups list                              |
| `identity-roles-list.png`               | Roles list                               |
| `sp-connection-new-grafana.png`         | New SP connection (Grafana example)      |
| `sp-connections-list.png`               | SP connections list                      |
| `saml-login.png`                        | End-user SAML login                      |

## Architecture diagrams

Mermaid sources (`.mmd`) and pre-rendered SVGs. GitHub does not execute Mermaid in all contexts — **commit updated `.svg` files** whenever you edit `.mmd` sources.

| File                           | Purpose                                                        | Used by                                                                                                             |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `architecture.mmd`             | Monolith: React UI, Nest modules, DB, external API, SP         | [proposal.MD](../proposal.MD) §5, [development.md](../development.md), root README                                  |
| `connection-types.mmd`         | API connection (inbound sync) vs SP connection (outbound SAML) | [proposal.MD](../proposal.MD) §4, root README                                                                       |
| `data-flow.mmd`                | High-level sync + assertion delivery                           | [proposal.MD](../proposal.MD) §4                                                                                    |
| `sync-flow.mmd`                | v1 fixed REST sync contract steps                              | [proposal.MD](../proposal.MD) §6.1, [tutorial.md](../tutorial.md)                                                   |
| `sso-flow.mmd`                 | SP-initiated SSO sequence                                      | [proposal.MD](../proposal.MD) §6.2, [development.md](../development.md), [tutorial.md](../tutorial.md), root README |
| `routing.mmd`                  | Production URL routing (API vs SAML vs SPA)                    | [development.md](../development.md)                                                                                 |
| `database-providers.mmd`       | `DATABASE_PROVIDER` + `prisma:prepare` workflow                | [database.md](../database.md)                                                                                       |
| `schema-entities.mmd`          | Entity-relationship diagram (11 Prisma models)                 | [database.md](../database.md), [proposal.MD](../proposal.MD) §9, [docs/README.md](../README.md)                     |
| `admin-auth-flow.mmd`          | Operator admin login + session cookie + CSRF                   | [database.md](../database.md), [development.md](../development.md)                                                  |
| `api-connection-crud.mmd`      | Create API connection → encrypt token → DB                     | [development.md](../development.md), [tutorial.md](../tutorial.md)                                                  |
| `admin-confirm-dialog.mmd`     | Evergreen confirm modal (replaces `window.confirm`)            | [development.md](../development.md) § Confirm dialog                                                                |
| `identity-list-pagination.mmd` | TanStack paginated identity lists (users/groups/roles)         | [development.md](../development.md) § Identity lists                                                                |
| `evergreen-ui.mmd`             | Evergreen tokens, `src/ui`, admin/login, responsive shell      | [development.md](../development.md) § Evergreen UI                                                                  |

Regenerate after editing sources:

```bash
pnpm diagrams:build
```

Requires `@mermaid-js/mermaid-cli` (installed on demand via `npx`). On GitHub Actions, Puppeteer uses `scripts/mermaid-puppeteer-ci.json` when `CI` is set.

Verify committed SVGs match sources:

```bash
pnpm diagrams:check
```
