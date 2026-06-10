# External identity API — v1 integration guide

NestIdP syncs users, groups, roles, and password hashes from one or more configured API connections. Each connection has its own `baseUrl`, authentication credentials, sync schedule, and identity scope — syncing one source never touches another's records. The external REST API for each connection must implement the contract below exactly. NestIdP only prepends the operator-configured `baseUrl` — there is no field or endpoint mapping in v1.

Product context: [proposal.MD §7](./proposal.MD) · operator setup: [development.md](./development.md) · mock server: [examples/mock-identity-api.mjs](./examples/mock-identity-api.mjs)

---

## Authentication

NestIdP supports two authentication methods per connection, configured in the admin console:

### Bearer token (static)

```http
Authorization: Bearer <token>
```

The token is stored encrypted at rest. Configure `authType: BEARER` and supply the token; `hasBearerToken: true` in the API response confirms a token is stored.

### OAuth 2.0 client credentials (v1.14.0)

NestIdP obtains a short-lived access token from a configured token endpoint using the
[OAuth 2.0 client credentials](https://www.rfc-editor.org/rfc/rfc6749#section-4.4) grant, then uses
it as a `Bearer` token for the identity API calls:

```http
Authorization: Bearer <access_token>
```

Configure `authType: OAUTH2` and supply:

| Field                   | Notes                                                           |
| ----------------------- | --------------------------------------------------------------- |
| Token URL               | `POST` endpoint for the client-credentials exchange             |
| Client ID               | OAuth application identifier                                    |
| Client secret           | Encrypted at rest; never returned to the browser                |
| Scope (optional)        | Space-separated scopes                                          |
| Audience (optional)     | Passed as `audience` in the token request body                  |
| Auth method             | `client_secret_post` (default) or `client_secret_basic`         |
| Extra params (optional) | Additional `key=value` pairs appended to the token request body |

Tokens are cached in memory and refreshed automatically when they expire. A failed exchange fails the sync run and is audited as `api_connection_oauth_token_failed`.

---

## Endpoints

All paths are relative to the connection `baseUrl` (no trailing slash on `baseUrl`).

| Method | Path                | Purpose                                          |
| ------ | ------------------- | ------------------------------------------------ |
| `GET`  | `/users`            | Full user snapshot (array)                       |
| `GET`  | `/users/:id/groups` | Groups for one user (`:id` = external user `id`) |
| `GET`  | `/users/:id/roles`  | Roles for one user                               |

NestIdP calls groups and roles **per user** after each successful user upsert. There is no bulk groups/roles endpoint in v1.

### `GET /users`

**Response `200`** — JSON array of user objects:

```json
[
	{
		"id": "usr_001",
		"username": "jdoe",
		"email": "jdoe@example.com",
		"displayName": "John Doe",
		"passwordHash": "$2b$12$...",
		"passwordHashAlgorithm": "bcrypt",
		"active": true
	}
]
```

| Field                   | Required | Rules                                                         |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `id`                    | yes      | Stable external identifier (string)                           |
| `username`              | yes      | Login identifier; stored trimmed; **case-sensitive** at login |
| `email`                 | yes      | Normalized (trim + lowercase) before persist                  |
| `displayName`           | yes      | Display string                                                |
| `passwordHash`          | yes      | **Hash only** — never plaintext                               |
| `passwordHashAlgorithm` | yes      | Must be `"bcrypt"` in v1                                      |
| `active`                | yes      | `false` → user cannot log in                                  |

### `GET /users/:id/groups`

**Response `200`** — JSON array:

```json
[
	{ "id": "grp_001", "name": "developers" },
	{ "id": "grp_002", "name": "admins" }
]
```

### `GET /users/:id/roles`

**Response `200`** — JSON array:

```json
[
	{ "id": "role_001", "name": "editor" },
	{ "id": "role_002", "name": "viewer" }
]
```

---

## Password hashes (proposal §14 Q5 — resolved)

v1 accepts **bcrypt only**.

| Topic                    | Requirement                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `passwordHashAlgorithm`  | Literal `"bcrypt"` — other values cause per-user sync errors                                                                   |
| Hash format              | Standard bcrypt modular crypt: `$2a$`, `$2b$`, or `$2y$` prefix + cost + salt + hash                                           |
| Verification             | NestIdP uses Node **`bcrypt.compare`** (same as admin passwords)                                                               |
| Cost factor              | **Embedded in the hash string** (e.g. `$2b$12$...`). Recommend cost **12** — matches `BCRYPT_COST_FACTOR` in `@nestidp/shared` |
| New hashes from your API | Any bcrypt-compatible generator (e.g. `bcrypt` npm, Python `bcrypt`, `$2y$` from PHP) works if `compare` accepts the prefix    |

**Rules:**

- Return **only** the hash in `passwordHash` — never plaintext passwords.
- On each sync, if the hash string changes, NestIdP updates the stored hash.
- Invalid or non-bcrypt hashes: user row skipped; error recorded in `SyncLog.errors` for that run.

**Symptom — login always 401 after “successful” sync:**

- `passwordHashAlgorithm` not `"bcrypt"`
- Hash is not a valid bcrypt string (wrong prefix, truncated, placeholder)
- User `active: false`
- Username mismatch (case-sensitive: `Alice` ≠ `alice`)

---

## Sync semantics (NestIdP behaviour)

| Behaviour                        | v1                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Sync mode                        | **Full snapshot** per run — entire `GET /users` response                                   |
| Users missing from snapshot      | **Soft-deactivate** (`active: false`, memberships cleared) — not hard-deleted              |
| Incremental / `updatedAt` filter | Not supported                                                                              |
| Max users per run                | `SYNC_MAX_USERS_PER_RUN` (default **10000**)                                               |
| Concurrency                      | One real sync per connection; stale `IN_PROGRESS` recovered after `SYNC_STALE_RUN_MINUTES` |
| `dryRun: true`                   | Fetches API and writes `SyncLog` only — no identity DB changes                             |
| Connectivity test                | `GET {baseUrl}/users?limit=1` with Bearer token                                            |

Trigger sync from the admin UI or `POST /api/admin/sync/:connectionId` (see [development.md](./development.md)).

---

## Error handling

| HTTP status                 | NestIdP behaviour                                              |
| --------------------------- | -------------------------------------------------------------- |
| `401` / `403`               | Sync run fails (auth)                                          |
| `404` on `/users`           | Sync run fails                                                 |
| `5xx` / timeout             | Sync run fails (`SYNC_HTTP_TIMEOUT_MS`, default 30s)           |
| `200` with invalid user row | Row skipped; error in `SyncLog.errors`; run may still complete |

Per-user group/role fetch failures are recorded per user; other users continue.

---

## Local mock server

For development and CI:

```bash
node docs/examples/mock-identity-api.mjs
```

Defaults: `http://localhost:4001`, Bearer token `test-token` (override with `MOCK_IDENTITY_PORT`, `MOCK_IDENTITY_TOKEN`).

Create an API connection with `baseUrl` `http://localhost:4001` and the same bearer token, then trigger sync.

---

## Outbound HTTP proxy (per connection, v1.14.0)

Some deployments must reach the identity API through a corporate **HTTP/HTTPS proxy**. This is
configured **per API connection** from the admin console (API connections → edit → _Outbound proxy_),
opt-in and **off by default**. When enabled, **every** outbound call for that connection traverses the
proxy: the sync fetches (`/users`, `/users/:id/groups`, `/users/:id/roles`), the OAuth token exchange,
and the _Test connection_ / _Test token_ / _Test proxy_ diagnostics.

| Field               | Notes                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable proxy        | Off by default; disabling keeps the stored values but connects directly                                                                                                                                                                                                                           |
| Proxy URL           | Absolute `http://`/`https://` URL (e.g. `http://proxy.corp.example:8080`). **No inline credentials** — use the username/password fields so the password is encrypted                                                                                                                              |
| Username / Password | Optional **Basic** proxy auth. The password is **encrypted at rest** in the local libSQL DB (same `CREDENTIALS_ENCRYPTION` as bearer tokens), **never** returned to the browser, **never** logged. Leave the password blank on edit to keep the stored one; send an explicit empty value to clear |
| No-proxy hosts      | Comma-separated patterns that **bypass** the proxy                                                                                                                                                                                                                                                |

**No-proxy matching** (case-insensitive): exact host (`api.corp.example`), `host:port`, leading-dot
domain suffix (`.corp.example` matches `api.corp.example`), `*` (bypass everything), and IPv4/IPv6
**CIDR** ranges (`10.0.0.0/8`, `192.168.0.0/16`, `fd00::/8`). `localhost`, `127.0.0.1`, and `::1`
always bypass. A DNS-name target never matches a CIDR token.

Only Basic proxy auth over `http://`/`https://` is supported. SOCKS, PAC files, and NTLM/Kerberos are
out of scope. TLS verification to both proxy and target stays on (no skip option).

### Validating the proxy

Use **Test proxy** to exercise _only_ the proxy hop (a probe to the target host through the proxy,
without running the user fetch). The result is classified so you can tell the proxy apart from the
target:

| Status          | Likely cause                                                        | What to do                                                                         |
| --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ok`            | Reached the target through the proxy                                | Proxy is working                                                                   |
| `auth_failed`   | Proxy returned **HTTP 407**                                         | Fix the proxy username/password                                                    |
| `unreachable`   | DNS failure / connection refused / connect timeout **to the proxy** | Check the proxy host:port and that it is reachable from the NestIdP host/container |
| `tunnel_failed` | Proxy reachable but refused the `CONNECT` tunnel to the target      | Check the proxy's allow-list / the target host:port                                |
| `tls_error`     | Certificate verification failed                                     | Fix the certificate chain (proxy or target)                                        |
| `target_error`  | Proxy + tunnel fine, target returned non-2xx / timed out            | Investigate the upstream identity API                                              |
| `bypassed`      | Proxy off or target matched `noProxyHosts`                          | Informational — the call would go direct                                           |

## v1 limits (not in this contract)

- No custom paths or JSON field mapping
- Argon2 / PBKDF2 hashes (out of scope)

---

## Checklist for integrators

- [ ] `GET /users` returns full directory as JSON array
- [ ] Every user has `passwordHash` + `passwordHashAlgorithm: "bcrypt"`
- [ ] Sample hash verifies with `bcrypt.compare(plaintext, hash)` in Node
- [ ] `GET /users/:id/groups` and `.../roles` use the same `id` as in the user list
- [ ] Bearer auth matches the token configured in NestIdP
- [ ] API reachable from NestIdP host/container network (production: HTTPS `baseUrl`)
