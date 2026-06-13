# External identity API — v1 integration guide

NestIdP syncs users, groups, roles, and password hashes from one or more configured API connections. Each connection has its own `baseUrl`, authentication credentials, sync schedule, and identity scope — syncing one source never touches another's records.

By default NestIdP calls the fixed v1 endpoints (`/users`, `/users/:id/groups`, `/users/:id/roles`) and reads identity from the standard field names. If your API uses different paths, a response envelope, renamed fields, or pagination, configure an [`apiContractConfig`](#api-contract-configuration-apicontractconfig-v190) on the connection — no middleware or adapter needed.

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

---

## API contract configuration (`apiContractConfig`) (v1.9.0)

Each connection accepts an optional `apiContractConfig` JSON blob that customises how NestIdP interprets the external API's responses. Omitting it (or setting it to `null`) applies the fixed v1 defaults described in the [Endpoints](#endpoints) and [GET /users](#get-users) sections above.

The config is **sparse** — any key you omit keeps its default; you only need to specify what differs.

### Endpoint paths

```json
{
	"endpoints": {
		"usersPath": "/api/users",
		"userGroupsPath": "/api/users/:id/groups",
		"userRolesPath": "/api/users/:id/roles"
	}
}
```

Defaults: `/users`, `/users/:id/groups`, `/users/:id/roles`. `:id` is substituted with the mapped external user `id` at runtime. `userGroupsPath` and `userRolesPath` must include `:id`.

### Response envelope (`responseRoot`)

Dot-path to unwrap a JSON envelope before reading the rows. An empty string (default) means the response body **is** the array.

```json
{
	"responseRoot": {
		"users": "data.items",
		"groups": "result",
		"roles": ""
	}
}
```

Nested paths up to 8 levels deep; only `[A-Za-z0-9_.-]` characters allowed per segment.

### Field mapping (`userFieldMap`, `groupFieldMap`, `roleFieldMap`)

Rename the JSON keys NestIdP reads from each row. Values are dot-paths into the source object.

```json
{
	"userFieldMap": {
		"id": "userId",
		"username": "loginName",
		"email": "emailAddress",
		"displayName": "profile.fullName",
		"passwordHash": "credentials.hash",
		"passwordHashAlgorithm": "credentials.algorithm",
		"active": "enabled"
	},
	"groupFieldMap": { "id": "groupId", "name": "groupName" },
	"roleFieldMap": { "id": "roleId", "name": "roleName" }
}
```

Defaults: identity mapping (JSON field name = NestIdP field name). Partial overrides merge over defaults — unspecified keys keep their defaults.

### Fixed algorithm (`passwordHashAlgorithmConstant`)

When the API returns hashes without an algorithm field, set a constant so you don't need to map `passwordHashAlgorithm` on every row:

```json
{ "passwordHashAlgorithmConstant": "bcrypt" }
```

Takes precedence over `userFieldMap.passwordHashAlgorithm` for every row in the run.

### Membership source (`membershipSource`)

By default NestIdP makes per-user calls to the group and role endpoints. If your API embeds membership inside the user object, use `embedded` mode with a dot-path into the user row:

```json
{
	"membershipSource": {
		"groups": { "mode": "embedded", "embeddedPath": "groups" },
		"roles": { "mode": "embedded", "embeddedPath": "membership.roles" }
	}
}
```

`endpoint` (default) and `embedded` can be mixed — e.g. embedded groups, endpoint roles. When `embedded`, the per-user group/role endpoint calls are skipped entirely.

### Pagination (`pagination`)

| `mode`             | Required params | Optional params                                                             |
| ------------------ | --------------- | --------------------------------------------------------------------------- |
| `"none"` (default) | —               | —                                                                           |
| `"offset"`         | `offsetParam`   | `limitParam`, `pageSize` (default 100), `maxPages`                          |
| `"page"`           | `pageParam`     | `limitParam`, `pageSize` (default 100), `startPage` (default 1), `maxPages` |

```json
{
	"pagination": {
		"mode": "offset",
		"limitParam": "limit",
		"offsetParam": "offset",
		"pageSize": 100,
		"maxPages": 200
	}
}
```

NestIdP stops fetching when the API returns fewer rows than `pageSize` or `maxPages` is reached (whichever comes first).

### Active-field mapping (`activeMapping`)

For APIs that use inverted booleans (`blocked: true` → inactive) or string values instead of booleans:

```json
{ "activeMapping": { "inverted": true } }
```

```json
{ "activeMapping": { "trueValues": ["active", "ENABLED", "1"] } }
```

`inverted` and `trueValues` can be combined. When `trueValues` is set, the raw field value is coerced to string and matched case-sensitively against the list.

### Extra query params and headers

Injected on every outbound call for this connection. `Authorization` cannot be overridden here (use the connection auth fields instead).

```json
{
	"queryParams": { "include_inactive": "true" },
	"headers": { "X-Tenant-ID": "acme" }
}
```

Up to 20 entries per map; keys and values ≤ 256 characters.

### Default values (`defaults`)

Applied when the mapped field is absent from the API row:

| Key                       | Type             | Effect                                                          |
| ------------------------- | ---------------- | --------------------------------------------------------------- |
| `displayNameFromUsername` | `boolean`        | Copy the mapped `username` value into `displayName` when absent |
| `email`                   | `string \| null` | Fallback email when the API omits the field                     |

```json
{ "defaults": { "displayNameFromUsername": true, "email": "noreply@corp.example" } }
```

### Error policy and caps

| Key                | Default  | Description                                                                   |
| ------------------ | -------- | ----------------------------------------------------------------------------- |
| `onRowError`       | `"skip"` | `"skip"` records the error and continues; `"fail"` aborts the entire sync run |
| `maxGroupsPerUser` | `null`   | Truncate groups per user beyond this cap (1–10 000)                           |
| `maxRolesPerUser`  | `null`   | Truncate roles per user beyond this cap (1–10 000)                            |

### Presets

Two starter templates are available in the admin console (`API connections → edit → Load preset`):

**`keycloak-like`** — Keycloak Admin REST API (`/admin/realms/master/...`), offset pagination (`max` / `first`), maps `enabled` → `active` and `firstName` → `displayName`.

**`auth0-like`** — Auth0 Management API (`/api/v2/...`), page pagination, maps `user_id` → `id`, `name` → `displayName`, `blocked` → `active` with `inverted: true`.

### Complete example

```json
{
	"endpoints": {
		"usersPath": "/api/v2/users",
		"userGroupsPath": "/api/v2/users/:id/groups",
		"userRolesPath": "/api/v2/users/:id/roles"
	},
	"responseRoot": { "users": "data" },
	"userFieldMap": {
		"id": "user_id",
		"email": "email",
		"displayName": "name",
		"passwordHash": "app_metadata.passwordHash",
		"active": "blocked"
	},
	"passwordHashAlgorithmConstant": "bcrypt",
	"activeMapping": { "inverted": true },
	"pagination": {
		"mode": "page",
		"pageParam": "page",
		"limitParam": "per_page",
		"pageSize": 50,
		"startPage": 0,
		"maxPages": 50
	},
	"onRowError": "skip"
}
```

---

## v1 limits (not in this contract)

- Argon2 / PBKDF2 hashes (out of scope — bcrypt only)

---

## Checklist for integrators

- [ ] `GET /users` returns full directory as JSON array
- [ ] Every user has `passwordHash` + `passwordHashAlgorithm: "bcrypt"`
- [ ] Sample hash verifies with `bcrypt.compare(plaintext, hash)` in Node
- [ ] `GET /users/:id/groups` and `.../roles` use the same `id` as in the user list
- [ ] Bearer auth matches the token configured in NestIdP
- [ ] API reachable from NestIdP host/container network (production: HTTPS `baseUrl`)
