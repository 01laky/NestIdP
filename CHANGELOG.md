# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.20.4]

Codebase audit pass: correctness fixes found by a full src/docs review, each covered by a regression
test. No new features; no behavior change to the happy paths.

### Fixed

- **Sync: mass-deactivation guard (data-loss).** When the external API returned a non-empty body whose
  rows all lacked a usable id (e.g. the id field path was renamed upstream), `seenUserExternalIds` was
  empty and `deactivateUsersNotInExternalIds` ran `notIn: []`, which Prisma treats as "match all" —
  deactivating **every** synced user while the run still reported SUCCESS. The run now aborts (FAILED)
  with a `parse_users` error when rows are returned but none are usable. A genuinely empty body still
  deactivates all (intentional, unchanged). `apps/api/src/sync/services/sync.service.ts`.
- **Sync: orphan-deletion skipped after a membership fetch failure (data-loss).** A group/role that was
  "seen" only via a user whose membership fetch failed was treated as orphaned and deleted, cascade-
  deleting still-valid membership rows. Orphan deletion is now skipped for any kind (`group`/`role`)
  whose membership fetch failed for ≥1 user that run. `sync.service.ts`, `sync/utils/sync-counters.ts`.
- **SP connections: SOAP-SLO certificate-removal guard.** `update` could strip the SP certificate while
  a SOAP SLO endpoint remained configured — the exact state `create` refuses (the cert is needed to
  verify the SP's `LogoutResponse`). The cert-removal guard now also accounts for the effective
  `sloSoapUrl`. `apps/api/src/sp-connections/services/sp-connections.service.ts`.
- **`TRUST_PROXY` env parsing.** Only the literal `true`/`1` enabled trust-proxy; `yes`/`on`/`True`
  were silently ignored, leaving `req.ip` as the proxy IP (corrupting rate-limit keys and audit IPs).
  Now uses the shared `parseBoolEnv`. `apps/api/src/common/utils/http-security.ts`.
- **Web: `Checkbox` id collision.** The DOM id was derived from the label text, so two checkboxes with
  the same label (e.g. a group and a role both named "Admins") collided and clicking one toggled the
  other. Now falls back to `useId()` like `TextInput`. `apps/web/src/ui/Checkbox.tsx`.
- **Web: create form pre-filled from a previously edited connection.** The `new` and edit routes shared
  one component instance, so navigating edit → new left all fields (including secrets) populated. Each
  form route now has a distinct `key`, forcing a fresh mount. `apps/web/src/admin/AdminLayout.tsx`.
- **Web: `completeSsoLogin` dropped `Retry-After` on 429.** A throttled SSO completion showed a generic
  error with no backoff timer; it now forwards `retryAfterSeconds` like the other auth calls.
  `apps/web/src/auth/authApi.ts`.

### Documentation

- `docs/deployment.md`: corrected the `/ready` response shape (`status` is `ok`/`unavailable`; the
  separate `database` field carries `connected`/`disconnected`/`not_configured`).
- `docs/deployment.md`, `docs/database.md`, `docs/RELEASE.md`: the `db:backup`/`db:dump`/`db:restore`/
  `db:rekey` scripts live in the `@nestidp/api` workspace (not the repo root); documented the
  `pnpm --filter @nestidp/api …` invocation that actually works from root and inside the container.
- `docs/proposal.MD`: login URL param is `samlSessionId`, not `samlRequest`/`relayState`.
- `docs/integration-api.md`: corrected the connectivity-test request (configured `usersPath` + optional
  pagination `limitParam`, not a hardcoded `/users?limit=1`) and the `auth0-like` preset's active
  mapping (`activeMapping: { trueValues: ['false'] }`, not `inverted: true`).
- `README.md`: version badge bumped to match `package.json`.

## [1.20.3]

### Fixed

- **CI docker-smoke job (`yaml: line 7: found character that cannot start any token`)** — both
  `deploy/docker-compose.prod.yml` and `deploy/docker-compose.dev.yml` were indented with tabs, which YAML
  forbids, so `docker compose up` failed to parse them. Converted all leading tabs to spaces. (The repo-wide
  "tabs everywhere" convention cannot apply to YAML; the `pnpm format` glob already excludes `.yml`/`.yaml`,
  so Prettier's `useTabs: true` will not re-introduce them.)

## [1.20.2]

Prod / dev environment separation (Prompt 41): `deploy/` folder, explicit `.prod`/`.dev` suffixes on all
compose files and env templates, standalone dev compose (no overlay + profiles trick), and a full set of
`docker:prod*` / `docker:dev*` pnpm scripts.

### Added

- **`deploy/` folder** — all deployment artifacts moved here; `Dockerfile` and `Dockerfile.dev` stay in
  root per Docker convention.
- **`deploy/docker-compose.prod.yml`** (renamed from `docker-compose.yml`): updated `build: { context: ..,
dockerfile: Dockerfile }`, `env_file: .env.docker.prod`, `IDP_BASE_URL` removed from compose
  `environment:` block so the env file value is always used (was previously silently overridden to
  `http://localhost:3000`).
- **`deploy/docker-compose.dev.yml`** (moved from root, now standalone — not an overlay): `build: { context:
.., dockerfile: Dockerfile.dev }`, `env_file: .env.docker.dev`, bind-mount updated `./` → `../`, all
  `profiles:` entries removed (no prod service to suppress when running standalone).
- **`deploy/.env.docker.prod.example`** (committed) — production env template with every secret as
  `change-me-generate-with-openssl-rand-hex-32`; `IDP_BASE_URL=https://idp.your-domain.com` (HTTPS);
  `MIGRATE_ONLY=0` with init-container explanation; full commented tuning section.
- **`deploy/.env.docker.dev.example`** (committed) — development env template with all secrets pre-filled
  with known dummy values (nothing to edit before first run); `IDP_BASE_URL=http://localhost:5173`;
  `VITE_API_PROXY_TARGET=http://127.0.0.1:3000`; mock-app connectivity hint for `localhost:4010`.
- **`deploy/README.md`** — self-contained folder guide: file table, quick-start for both envs, port
  usage table, DB storage table, port-conflict warning, useful commands table.
- **New pnpm scripts** in root `package.json`:
  `docker:dev`, `docker:dev:down`, `docker:dev:reset`, `docker:dev:logs`, `docker:dev:shell`,
  `docker:prod`, `docker:prod:down`, `docker:prod:reset`, `docker:prod:logs`, `docker:prod:migrate`.

### Changed

- **`scripts/docker-dev-entrypoint.sh`**: added startup log line
  "NestIdP [dev]: running in DEVELOPMENT mode — do not use in production".
- **`.gitignore`**: replaced `.env.docker` with `deploy/.env.docker.prod` and `deploy/.env.docker.dev`.
- **`docs/deployment.md`**: added `deploy/` intro; updated "First deploy" to `pnpm docker:prod`; updated
  "Upgrades" to reference `pnpm docker:prod:migrate`; updated all `docker compose exec/cp` commands to
  include `-f deploy/docker-compose.prod.yml`; replaced "Local development" section with env file table,
  DB storage table, simultaneous-env port-conflict warning, and useful shortcuts table.
- **`docs/development.md`**, **`docs/tutorial.md`**, **`docs/RELEASE.md`**, **`docs/README.md`**,
  **`README.md`**: updated all references from old script names and file paths to new ones; added
  `deploy/` entry to the docs index; expanded developer commands table in README.

### Removed

- Root-level `docker-compose.yml` (replaced by `deploy/docker-compose.prod.yml`)
- Root-level `docker-compose.dev.yml` (replaced by `deploy/docker-compose.dev.yml`)
- Root-level `.env.docker.example` (replaced by `deploy/.env.docker.prod.example`)
- pnpm scripts `dev:docker`, `dev:docker:down`, `dev:docker:reset` (replaced by `docker:dev*`)

---

## [1.20.1]

Docs fix: document the existing `apiContractConfig` system in `integration-api.md`; the file previously
contained a stale claim that there was no field or endpoint mapping in v1.

### Changed

- **`docs/integration-api.md`**: rewrote the intro to describe the default contract and point to the new
  section; replaced the stale "no field or endpoint mapping in v1" sentence; added a full
  **"API contract configuration (`apiContractConfig`) (v1.9.0)"** section documenting every config key:
  `endpoints`, `responseRoot`, `userFieldMap`/`groupFieldMap`/`roleFieldMap`, `passwordHashAlgorithmConstant`,
  `membershipSource` (endpoint vs embedded), `pagination` (none/offset/page), `activeMapping`
  (inverted + trueValues), `queryParams`, `headers`, `defaults`, `onRowError`, `maxGroupsPerUser`/`maxRolesPerUser`,
  and the two built-in presets (`keycloak-like`, `auth0-like`). Includes a worked JSON example; removes
  the stale "No custom paths or JSON field mapping" bullet from the v1 limits section.
- **`README.md`** and **`docs/README.md`**: updated integration-api.md description to reflect the
  expanded coverage (endpoints, field mapping, pagination, presets).

---

## [1.20.0]

Documentation overhaul (Prompt 40): professional README, screenshot spec, diagram, and docs update across all 14 deliverables.

### Added

- **Playwright docs-screenshot spec** (`apps/web/e2e/docs-screenshots.spec.ts`): 17 screenshots
  with mocked API responses and a CI isolation guard (`DOCS_SCREENSHOTS=1`). Covers admin login,
  dashboard, five IdP-settings states, API connection edit and sync, API connections list, identity
  users/groups/roles lists, SP connections list, new SP connection form (Grafana example), audit log
  with filters, and end-user SAML login. Writes directly to `docs/img/*.png`.
- **`docs:screenshots` script** in `apps/web/package.json` and root `package.json`
  (`pnpm build && pnpm --filter @nestidp/web docs:screenshots`).
- **`docs/img/scheduler-overview.mmd`** — new Mermaid diagram showing the three in-process schedulers
  (sync, cert-rotation, back-channel SLO) and how their `lastTickAt`/`lastProcessed` gauges surface in
  `/health`.
- **Two new screenshots**: `api-connections-list.png` (multi-source list with sync status) and
  `audit-log-filters.png` (filter controls and event table); both added to `docs/img/README.md` and
  `docs/img/screenshots.md`.

### Changed

- **Root `README.md`** (D1): full rewrite — `<div align="center">` hero with flat-square badges,
  "Why NestIdP?" comparison table vs Keycloak/Authentik/Lemonldap-NG, three `<details>` quick-start
  blocks (local dev, Docker, mock API), inline Mermaid SSO flow + connection-type + cert-roles
  diagrams, HTML 2-per-row screenshot grid (10 images), health monitoring section, 10-entry docs
  table, and developer commands table including `docs:screenshots`.
- **`docs/development.md`** (D2): removed stale "v1.1.0 — Phase 1 complete" subtitle; removed
  deprecated `v1 single-connection limit` note and "**v1: max 1**" annotation on the Create
  connection row; updated "Phase 1 complete" footer to "What's included"; added
  `IDP_SETTINGS_CACHE_TTL_MS` optional env table under the IdP settings section.
- **`docs/integration-api.md`** (D3): removed "one configured API connection" constraint; replaced
  the single-paragraph Auth section with full Bearer + OAuth 2.0 CC sub-sections (token URL,
  client ID/secret, scope, audience, auth method, extra params); removed stale `v1 limits` bullet
  "One API connection per deployment" and "No OAuth client credentials".
- **`docs/audit-events.md`** (D4): added v1.19.0 additions table for `idp_<kind>_cert_unparseable`
  and `idp_auto_rotation_deferred_boot`; added dedup note for `idp_<kind>_auto_rotation_due_soon`.
- **`docs/deployment.md`** (D5): expanded Health section to full `/health` + `/ready` response
  shape examples; added three missing env vars (`IDP_SETTINGS_CACHE_TTL_MS`, `PORT`,
  `BUILD_GIT_SHA`); added 6-scenario **Troubleshooting** section (503 ready, admin login 401, users
  can't log in post-sync, account lockout, SAML assertion rejection, scheduled sync not running,
  encrypted DB after key rotation).
- **`docs/RELEASE.md`** (D6): removed "v1.0.0" from title; replaced "Phase 2+ out of scope" section
  with a **Monitoring checklist** (load-balancer alerts, `/health` field meanings, recommended
  PagerDuty/Slack triggers).
- **`docs/README.md`** (D7): updated version badge to v1.20.0; added four missing diagram rows
  (multi-source-sync-flow, backchannel-slo-flow, sync-scheduler, scheduler-overview).
- **`docs/img/README.md`**: added `scheduler-overview.mmd` diagram entry; added two new screenshot
  entries (`api-connections-list.png`, `audit-log-filters.png`).
- **`docs/img/screenshots.md`**: added two new screenshot entries.
- **`docs/tutorial.md`** (D10): updated "v1 supports one external API connection" to multi-connection
  phrasing; added section 9 "Audit log" with the new `audit-log-filters.png` screenshot and event
  category descriptions; added audit-events.md and health monitoring cross-links in "Next steps".

## [1.19.0]

The Prompt 38 §7 optional additions, re-cut as a minor release, plus the Prompt 39 D5 follow-up.

### Added

- **`GET /api/admin/idp/settings/cert-rotation/status`** — a light admin endpoint returning only the
  per-kind auto-rotation status block (reusing the existing DTO shapes; byte-identical values to the full
  settings read), for dashboards/monitoring that don't need the whole settings payload.
- **New cert-rotation audit events**: `idp_<kind>_cert_unparseable` (an unparseable active cert is now
  audited once per cert — previously only a per-tick warn log) and `idp_auto_rotation_deferred_boot`
  (a due rotation check skipped by the `CERT_ROTATION_BOOT_GRACE_HOURS` window is recorded).
- **Audit log filters by `actorType` / `subjectType` / `subjectId`** on both the list and the JSON/CSV
  exports (validated — garbage actorType is a 400, not an empty page).
- **Operational health surface**: `/health` now reports `version`, `gitSha` (from `BUILD_GIT_SHA`, null
  when unset), `uptimeSeconds`, `audit: { persistFailures, lastPersistFailureAt }` (the previously
  invisible `audit_persist_failed` swallow is now a monotonic counter), and per-scheduler liveness gauges
  (`schedulers.{sync,backchannel,certRotation}: { lastTickAt, lastProcessed }`); `/ready`'s `migrations`
  became `{ applied, available, upToDate }` (available counted without reading SQL, so the §17 guard
  cannot fire from a health probe).
- **`SyncLog.groupsDeactivated` / `rolesDeactivated`** (additive nullable columns + migration
  `20260617120000_sync_log_deactivation_counts`): each run now persists how many orphan groups/roles its
  deactivation phase deleted (0 on dry runs and early failures; `null` on historical rows). Closes the
  Prompt 39 D5 TODO; the characterization goldens gained exactly the two new fields per scenario.
- **Admin SPA surface for the above** (web): the audit-log page gained `actorType` (select) /
  `subjectType` / `subjectId` filter controls that flow into both the list request and the JSON/CSV
  export links (filter submit still resets to page 1); the admin login page's existing 429
  retry-after countdown is now covered by a ticking fake-timer test (submit stays disabled until 0);
  and the sync-log detail page surfaces `groupsDeactivated` / `rolesDeactivated` (em-dash on legacy
  `null` rows). New i18n keys in all ten locales.

### Changed

- **Singleton IdP-settings reads are cached** (§A5): the ~14 hot-path reads of the `IdpSettings` row
  (SAML SSO/SLO/metadata, end-user auth, encryption key resolution, back-channel propagation) go through
  a per-Prisma-instance memo with a 5 s TTL plus explicit invalidation at every write site (all 13
  `idp-settings.service` writes + the first-use signing-material claim). Disabled inside jest workers
  (via `JEST_WORKER_ID`) and tunable via `IDP_SETTINGS_CACHE_TTL_MS` (0 disables). Read-modify-write paths keep direct reads.
- **Due-soon rotation notifications are deduped** — `idp_<kind>_auto_rotation_due_soon` (audit + notifier)
  now fires once per certificate (`notAfter`-keyed, re-armed by rotation; reset on restart), instead of on
  every scheduler tick inside the notify window (previously up to ~1440 duplicates/day).
- **Cert-rotation scheduler ticks log their duration** (`cert_rotation_tick_completed` with `durationMs`).

## [1.18.1]

Codebase-wide refactor + hardening pass (Prompt 38): the §5 security/correctness fixes (each with a
regression test), all ten §6 behaviour-preserving refactor workstreams (identity-store parity,
cert-lifecycle unification, sync decomposition behind characterization goldens, frontend
de-duplication, …) and the full PART III safety-net set (§11 goldens, §12 race harness, §13 import
boundaries, §14 transactional-integrity sweep, §15 audit-event registry, §16 secret-leak guard,
§17 migration-safety guards, §18 injectable clocks, §19 typed-config ratchet + bundle hygiene).

**Rollback note (§20):** 1.18.1 introduces **no schema migrations** (local or external — the optional
`SyncLog.dryRun` column was _not_ taken; the dry-run sentinel stays). Some fixes change DB-write
_atomicity_ (transactions around existing writes) but not the written shapes, so rolling back to
1.18.0 is safe in any order; the three renamed audit-event families keep their old names in
historical rows (see `docs/audit-events.md`).

### Changed

- **`sync.service` decomposition completed** (Prompt 39 / §6.8 reconciliation): `triggerSync` is now a
  50-line orchestrator over named phases — `beginRun` (load/validate/claim), `fetchAndMapUsers`
  (bearer + users fetch + row mapping; null-return on early failure), `applyUserMemberships` (descriptor
  construction + gather + apply) and `deactivateOrphans` (phase C, now capturing the
  `deleteOrphanGroups`/`deleteOrphanRoles` return counts into the new
  `SyncCounters.groupsDeactivated`/`rolesDeactivated` diagnostics fields). `SyncCounters` moved to
  `sync/utils/` and absorbed the per-run `Set`s plus the once-per-id counting mutators
  (`addUser`/`addGroupOnce`/`addRoleOnce`/`addCollision`/`setDeactivated`/`toCounterSnapshot`); a new
  `SyncErrors` wrapper (`sync/utils/sync-errors.ts`) replaces the raw error-entry array and the D3 push
  helpers now take it plus a `kind: 'group' | 'role'` (phase strings derive from the kind inside the
  helpers). The membership descriptor is exported as `MembershipDescriptor` from
  `sync/utils/membership-descriptor.ts` and both call sites construct it inline with
  `satisfies MembershipDescriptor`. **§5.B3 fix (the one intentional behaviour change):**
  `usersSkippedCollision` is now a required counter carried on _every_ terminal path — the early
  bearer/fetch-users FAILED exits and the stale-run reclaim previously omitted it from `finishLog`
  (`SyncLogService.finishLog` no longer re-defaults it); the two characterization goldens pinning the
  old 3-field shape were updated (each diff is exactly one added `"usersSkippedCollision": 0`). New
  tests: `sync-counters.spec`, `sync-errors.spec`, `outbound-http.util.spec` (timeout abort, origin
  violation, envelope extraction), the §5.B3 early-exit regression, the `clearAutoPause` pair and the
  FAILED/`finishLog`-null finalize-path cases; `runPool` gained `concurrency <= 0` and
  `items < concurrency` cases (it stays in `common/utils/` — shared with api-connections — and
  `gatherMemberships` keeps its keyed-Map accumulator with a why-not-`runPoolMap` note).
- **Shared literal-union types for the SAML/IdP status families** (§6.4 / §A14): added the missing
  `BACKCHANNEL_LOGOUT_STATUSES` const tuple (with `BackchannelLogoutStatus` now derived from it and an
  `isBackchannelLogoutStatus` guard) and the missing `SamlNameIdFormat` union, `isSamlNameIdFormat` guard
  and `DEFAULT_SAML_NAME_ID_FORMAT` constant derived from the existing `SAML_NAME_ID_FORMATS` tuple. The
  IdP-controlled DTO fields are now typed against these instead of bare `string`:
  `SpConnectionPublicDto.lastBackchannelLogoutStatus` (narrowed at the mapper boundary via the new guard)
  and `AdminDashboardIdpStatusDto.signingKeyFamily`/`signingEcCurve` (reusing `IdpCertKeyFamily`/
  `IdpCertEcCurve` rather than re-declaring the literals). The hand-typed `emailAddress` default in
  `sp-connections.service` now uses `DEFAULT_SAML_NAME_ID_FORMAT`. Behaviour-preserving; the lax-validated
  request DTOs keep `string` until validation is tightened (§6.3/§A12).
- **Shared config parsing helpers** (§6.1): one `boundedInt` (env → bounded number, falling back on
  absent/empty/out-of-range) and one `parseBoolEnv` (truthy-env), replacing the duplicated inline copies.
  The shared `boundedInt` fixes a foot-gun the copies shared — an empty env var parsed as `0` (via
  `Number('')`), which for a `min: 0` knob (scheduler tick, jitter, grace) silently disabled the feature
  instead of using its default. Adopted in the back-channel/sync-schedule/multi-source/rate-limit/
  cert-rotation configs + the OAuth/identity-sync clients, and the `MIGRATE_ONLY` checks across `main.ts`
  and the three schedulers.
- **Shared `positiveIntOrDefault` config helper** (§6.1): the second config-parse shape in the codebase —
  `Number.parseInt(String(raw), 10)` + strictly-`> 0` (preserving `parseInt` leniency, distinct from
  `boundedInt`'s `Number()` + explicit `[min, max]`). Replaces the hand-copied inline copies in the
  admin/end-user session-TTL readers, the admin-user-create and SAML-SLO rate limiters, the SAML
  clock-skew reader and the audit-retention day count. `proxy-dispatcher`'s connect-timeout reader (a
  `Number()` + range copy) now uses the existing `boundedInt`. Behaviour-preserving.
- **Admin SPA load/error boilerplate de-duplicated** (§6.9 / §A15+§A16): the identity sync-source filter
  (`useIdentitySources()` hook + `<SourceFilterSelect>`) was already lifted out of the user/group/role/SAML-
  session pages; this increment adds a single `mapAdminError(err, fallbackKey)` helper that collapses the
  ~50 copy-pasted `err instanceof AdminApiError ? formatAdminApiError(…) : t(…)` catch ladders into one
  call (the namespaced fallback key resolves identically through `resolveI18nKey`), and a
  `useAdminResource(loader, { fallbackKey, deps })` hook that replaces the repeated
  `let cancelled = false; void (async () => { … })(); return () => { cancelled = true }` load effect with a
  single hook carrying the same out-of-order/unmount guards as `useIdentityListQuery`. Adopted in the SP/API
  connection list pages, the dashboard, the sync-log detail page and the user/group/role detail pages.
  Behaviour-preserving; form pages (react-hook-form `reset`) and the silent-refresh list keep their bespoke
  loaders. The identity-list query serialiser was also generalised to one `toQuery()` helper (skips
  `undefined`/`''`, stringifies booleans) and reused by the sync-log, SAML-session and test-SSO-URL endpoints
  in `adminApi.ts`, replacing their per-endpoint `new URLSearchParams(); if (x) params.set(…)` ladders.
- **Identity group/role page families collapsed** (§6.9 / §A17): the ~95%-identical group and role
  create/edit pages now share one config-driven `<SimpleNameFormPage>` component, and the ~90%-identical
  group and role detail pages share one `<IdentityMemberDetailPage>`; each page is reduced to a thin wrapper
  supplying a per-kind descriptor (API calls, routes, i18n keys). Behaviour-preserving — the existing identity
  CRUD/edge suites and the evergreen/responsive static guards (updated to point at the shared components)
  stay green.
- **Identity list pages collapsed onto one shell** (§6.9 / §A17): the ~95%-identical user/group/role list
  pages now share a config-driven `<IdentityListPage>` shell (header, origin/source filter toolbar, optional
  search field + info callout, lazy paginated table, section nav). Each page is a thin wrapper supplying its
  columns, fetcher, routes and i18n keys; the user page additionally enables the search box and callout. The
  evergreen/responsive/pagination static guards were repointed at the shell where the toolbar UI now lives.
- **IdP cert-action handlers unified** (§6.9 / §A17): the ten near-identical signing/encryption handlers in
  `IdpSettingsPage` (generate / upload / start-rotation / complete / cancel × 2) now flow through one
  `useCertActions(config, ctx)` helper driven by a per-kind descriptor (the `adminApi` calls, options object,
  confirm-summary builder and i18n keys). Behaviour-preserving — the same REPLACE/COMPLETE type-to-confirm
  challenges, reload + metadata-refresh sequencing and success/toast messaging; the 48-test IdpSettingsPage
  suite (signing and encryption flows) stays green.
- **IdP cert panels share one `<CertificateSection>`** (§6.9 / §A17): the signing and encryption sections of
  `IdpSettingsPage` shared a three-panel scaffold (active-cert panel, PEM-upload panel, rotation checklist)
  but diverged in the crypto rows, action buttons and pending-rotation summary. Those divergent bits are now
  passed as slots to one `<CertificateSection>` component so the rendered DOM is byte-identical; the page
  drops ~200 lines overall (1120 → ~920). Behaviour-preserving — the full IdpSettingsPage suite stays green.
- **`adminApi.ts` split into domain modules** (§6.9): the 873-line client is now ten focused modules under
  `admin/adminApi/` (`core` — `adminFetch`/`AdminApiError`/CSRF/`toQuery`; then `auth`, `api-connections`,
  `sp-connections`, `sync`, `saml-sessions`, `identity`, `idp-settings`, `audit`, `external-db`), with
  `admin/adminApi.ts` reduced to a re-export barrel. No call sites or tests changed — `import … from
'../adminApi'` and the `vi.spyOn(adminApi, …)` pattern (~480 sites) keep working through the barrel.

- **`@TransformOptionalInt()` for boot env validation** (§6.1, final piece): the identical optional-int
  `@Transform` block was copy-pasted 23× in `env.validation.ts`; one decorator replaces them all
  (390 → 253 lines). Empty/absent stays `undefined`, non-numeric input passes through unchanged so
  `@IsInt()` rejects it loudly.
- **`SyncService` decomposed behind characterization goldens** (§11/§6.8): before touching the ~1000-line
  service, 8 golden scenarios (clean run, collision-skip/fail_run, membership-phase failure, deactivation
  with dropped-row entry, dry-run, `syncAll` aggregate, fetch failure) snapshot the ordered `finishLog`
  args, the ordered identity-store mutation sequence, the audit events and the returned DTOs — committed
  first, then the refactor landed with the fixtures **byte-identical**. The decomposition: a `SyncCounters`
  object (preserving the historical 3-field vs 4-field `finishLog` asymmetry), pure error-entry pushers in
  `sync-error-entries.util.ts` (groups/roles mirrors collapsed behind per-kind descriptors), the remaining
  groups-vs-roles membership mirrors unified behind a `MembershipKind` descriptor (asymmetries — collision
  error classes, entry field names, per-kind caps — encoded, not papered over), one `finalizeRun` for the
  success/failure finishes (deliberate ordering asymmetries documented in place), and a shared
  `outbound-http.util` (URL build + fetch + array extraction) de-duplicating the sync client and the
  connection-test service (dead `url` param dropped, per-caller timeouts kept).
- **DTO boundary cleanups** (§6.3/§A20): one shared `@Trim()` decorator replaces the ten hand-copied
  string-trim `@Transform` blocks across the admin-user / api-connection / end-user-login /
  manual-identity / schedule DTOs (the long null-checking variant was behaviour-identical); the two
  start-rotation controller endpoints replace their blind `as`-casts with typed `toStartIdp*RotationRequest`
  mappers that build the correct member of the shared discriminated union; and the signing/encryption
  generation defaults share one `DEFAULT_IDP_RSA_MODULUS_BITS` constant in `@nestidp/shared` instead of six
  scattered `2048` literals. Assessed and intentionally left: `UpdateManualUser`/`UpdateAdminUser`/
  `UpdateSchedule` are not `PartialType` candidates (different field sets/null semantics than their create
  counterparts; schedule has no create), and the various coincidental `512` max-lengths stay independent
  (entity-id vs user-agent vs URL bounds are unrelated — one constant would couple them artificially).
- **Audit-event registry + naming convention** (§15): every persisted audit `event` name now comes from
  the single registry `apps/api/src/audit/audit-event-names.ts`, and `AuditRecordInput.event` is typed
  against it — the **compiler** rejects an event string built outside the registry. The scheme
  (`snake_case`, `<subject>_<action>[_<qualifier>]`) is documented in the new `docs/audit-events.md`
  (full catalogue with category + actor type) and enforced by the `AUDIT-REG-*` tests, which also reject
  dead registry entries and hold stdout-only log events to the same scheme. Three inconsistent families
  were renamed (historical rows keep their old names — update SIEM rules): the dotted
  `identity.user.created` family → `identity_user_created` (9 events), the external-DB **connect** path no
  longer mis-emits `identity_db_test` → `identity_db_connected`, and the flipped
  `idp_<kind>_rotation_auto_started/_completed` → `idp_<kind>_auto_rotation_started/_completed` (aligning
  with the rest of the `auto_rotation_*` family).
- **Injectable clock/randomness across the §6-touched time paths** (§18): `isCertExpiringSoon` takes an
  injectable `now`, the cert-rotation scheduler's `applyJitter` uses injectable randomness instead of
  `Date.now() % range` (which was a deterministic, predictable function of wall-clock — not jitter; aligned
  instances would collide), the shared `HmacSessionCodec.verify` and both session services'
  `createPayload`/`verify` accept an injectable `nowSeconds`, and `IpBanService.check`/`recordTrip` accept
  an injectable `now` (prune already did). Account lockout already threaded `now: Date` params and the
  sliding-window limiter already had a constructor clock. Session-expiry, ban-expiry and cert-expiry tests
  now run against fixed clocks (HMAC-CODEC-12, BAN-05, API-IDP-VAL-CLK-01) — no real-time waits.

### Added

- **The §8 test-coverage gaps are closed**: a 24-test HTTP integration suite for the admin SAML-sessions
  controller (`API-SESS-CTRL-*` — list filters, single/bulk/by-user/kill-switch terminate, back-channel
  resend/process incl. the module-absent 503 path, CSRF on all six mutating POSTs, authz on all eight
  endpoints, DTO validation matrix), a `logout-propagation-notifier` unit suite (`BC-NOTIF-*`), unit suites
  for `SpConnectionTestSsoUrlService` (`API-SP-TSSO-U-*` — incl. cryptographic verification of the signed
  test-SSO URL and RelayState tamper coverage) and `SpConnectionProbeSigningService` (`API-SP-PROBE-U-*`),
  and the five `ExternalIdentityDatabasePage` action error paths in the web suite (`WEB-EXTDB-ERR-*`).
  Plus `apps/api/test/TEST-IDS.md` — the test-ID prefix registry (§6.10).
- **ESLint import-boundary rules** (§13): four `no-restricted-imports` blocks (each with an inline
  rationale) now make the layering permanent — `auth`/`bootstrap` ↛ `admin-auth` (and the reverse),
  the external identity store ↛ the Prisma-bound `identity.repository`, and the SPA ↛ server-only
  dependencies (`cron-parser` directly, `@nestjs/*`, `@prisma/*`, `kysely`, `xml-crypto`, …). To enable
  the first rule, `password.util` moved from `admin-auth/utils/` to `common/crypto/` (the §6.5 leftover) —
  it was imported by end-user auth, bootstrap and identity-admin across the module boundary. A deliberate
  violation was verified to fail `lint` and then removed.
- **End-to-end secret-leak guard test** (§16): the `SLG-*` suite drives sentinel secrets (a bcrypt hash,
  an `ENCRYPTION_KEY`-shaped string, an OAuth client secret, a proxy password, a session cookie, a
  private-key PEM) through every formatting path that can reach logs or HTTP clients — audit metadata
  (top-level **and** nested), the `redactSecrets` string scrubber in its production wire shapes, and the
  global `RedactingExceptionFilter` (string, object and nested payloads; plain `Error` stays a generic 500) — and asserts none of them survive. A boundary test pins that key-name-based metadata redaction
  does NOT catch a secret under an innocuous key (proving the guard bites). Writing the guard immediately
  caught a real hole: `encryptionKey`-style metadata keys slipped past the `encrypted` substring — the
  denylist now also covers `encryptionkey`.
- **Migration-safety guard** (§17): `assertSplittableSql` in the boot migrator rejects any
  `migration.sql` the naive `;`-splitter cannot apply safely — `CREATE TRIGGER`, standalone
  `BEGIN`/`END`, a `;` inside a string literal, or an unterminated literal — with a
  `DbMigrationError('unsafe_migration')` naming the offending file, **before** any DDL runs. The
  constraints are documented in the new `docs/migrations.md`; the `MIG-GUARD-*` tests also assert every
  real migration in `apps/api/prisma/migrations/` passes the guard. The external-DB side gained the
  `EXT-LADDER-*` PGlite suite (v0 → current upgrade, idempotent re-run, half-init recovery, foreign-DB
  rejection) plus two behaviour fixes it demanded: a **downgrade guard** (`runExternalMigrations` refuses a
  schema stamped by a newer build instead of silently modifying it) and **legacy half-init recovery** — a
  `nestidp_meta` table without an instance marker (a pre-1.18.1 crash between schema creation and the
  marker write) is now classified recoverable and re-initialised, instead of being bricked as `foreign`
  forever.
- **Race-harness self-test** (§12): `RACE-SELF-*` tests prove `runConcurrently` genuinely overlaps its
  invocations (all N in flight simultaneously before any completes) — a race regression test built on a
  secretly-serialising helper would prove nothing.
- **Typed-config ratchet** (§19): `scripts/check-config-access.mjs` (wired into root `pnpm lint`) freezes
  the current set of files reading `ConfigService` directly — a new direct reader outside the `*Config`
  provider files fails lint, and a migrated file must be removed from the allowlist (the list can only
  shrink). It already caught the schedules-overview cleanup dropping its last direct read.
- **Bundle hygiene check** (§19): `scripts/check-web-bundle-size.mjs` now also scans every SPA chunk for
  server-only dependency markers (`@prisma/client`, `@libsql/client`, `xmlbuilder2`) and fails the build
  on a leak. `cron-parser` is deliberately **not** on the list: the admin schedule form legitimately uses
  the shared cron helpers client-side for validation and the "next runs" preview.

### Security

- **SAML cert generation no longer shells out with string interpolation** — `openssl` is invoked via
  `spawnSync` with an argv array and no shell, so an operator-controlled `entityId` (used as the cert CN)
  can no longer inject a command (`apps/api/src/saml/utils/openssl.util.ts`).
- **Signed assertions never fall back to unsigned** — if signing or signed-fragment extraction fails, the
  IdP now throws instead of silently emitting an unsigned `<saml2:Assertion>`.
- **Back-channel SLO response signature is verified on the original bytes, and the status read is scoped**
  (§A3) — the SP `LogoutResponse` signature is now checked against the received SOAP body instead of a
  re-serialised `LogoutResponse` substring (re-serialisation re-emits namespaces/whitespace and breaks
  XML-DSig canonicalisation), the status `StatusCode` is read relative to the verified response element
  (not a document-wide xpath), and a SOAP body carrying more than one `LogoutResponse` is rejected outright —
  so a signature-wrapping payload (a second, attacker-controlled response) can't flip the interpreted status.
- **Encryption-cert key-usage check is Node-native, not an `openssl` subprocess** (§B8) —
  `certHasEncryptionKeyUsage` now parses the X.509 KeyUsage extension (OID 2.5.29.15) directly from the
  certificate DER instead of shelling out to `openssl x509 -ext keyUsage` per upload. This removes the
  synchronous event-loop block, the temp-file write, and the dependency on the `openssl` binary and its
  locale-specific output (any failure of which previously rejected a valid cert). It fails closed on
  non-certificate input. (`X509Certificate.keyUsage` is unusable here — Node exposes the _extended_ key
  usage there, not the basic KeyUsage bits.)
- **Certificate crypto metadata is no longer silently mislabelled** (§B8) — `detectRsaModulusBits` now
  throws when the RSA modulus size can't be read (instead of storing a wrong `2048`), and `namedCurveToLabel`
  throws on an unknown EC curve (instead of mislabelling it `P-256`); both surface as a `400`.
- **Admin logout CSRF check is constant-time** (`timingSafeEqual` via `AdminCsrfService`) and the logout is
  now actually audited (the previous `req.adminUser` guard was dead, so logouts went unrecorded).
- **Login-failure poisoning fixed** — a _correct_ password that then fails to bind to the SAML session
  (expired / already-bound / inactive SP → 400/409) no longer counts toward the per-IP/username throttle or
  the account lockout; only genuine credential failures do.
- **Test-ACS SSRF guard** — the admin "test ACS" probe refuses private/loopback/link-local hosts (e.g. cloud
  metadata `169.254.169.254`) and no longer follows redirects (`redirect: 'manual'`).
- **Audit CSV export neutralises spreadsheet formula-injection** (cells starting `= + - @` are quoted) and
  now includes the event `id` column.
- **Audit metadata redaction is deep + substring-matched + byte-measured** — secrets nested at any depth
  (e.g. `{ details: { password } }`) and variants like `oauthClientSecret`/`apiKey` are stripped.
- **Bounded in-memory rate-limit maps** — the IP-ban, SAML-SLO and admin-user-create limiters now prune
  expired entries, preventing unbounded memory growth under a distinct-IP spray.

### Fixed

- **API small correctness fixes** (§5.C, api batch) — the remaining low-severity FIX items from the
  PART I module audit, each with a regression test:
  - _Sync_: rows with a missing/non-string external user id now emit explicit `parse_users` error entries
    instead of being silently dropped (and later deactivated); the paginated users fetch now **throws** the
    same `user_limit` validation error as the non-paginated path when the cap is exceeded (was: silent
    truncation) and stops on a repeated page; the per-connection collision-policy override is validated on
    read (unknown values fall back to the global policy); the schedules overview counts `manual_all` runs
    separately (new additive `manualAllRunCount` DTO field) instead of folding them into "manual"; the
    error-list truncation marker uses a new dedicated `truncated` phase (was: polluted `parse_users`);
    `parseSyncLogErrors` validates DB JSON instead of blind-casting; `POST sync/:id` accepts `?dryRun=true`
    like `sync/all`; `removeSourceIdentities` session termination is bounded (shared `runPool`, concurrency 5) with per-user error isolation; the connection-test preview applies the same users-per-run cap as a
    real sync; the username-only proxy `Basic` credential and the stale-run reclaim window are documented.
  - _SAML_: the admin session-list search escapes LIKE wildcards and matches case-insensitively (same fix
    as the identity stores); back-channel logout verification reads `SAML_CLOCK_SKEW_SECONDS` instead of a
    hardcoded 60s; a SOAP `LogoutResponse` without `InResponseTo` is rejected; the SLO replay-id is recorded
    only after session termination succeeds (a failed logout no longer burns the id against the SP's
    legitimate retry); the `logout_completed` audit fires only after the response is actually built/signed;
    the LogoutRequest builder rejects an empty NameID and filters empty SessionIndexes; the non-standard
    `Issuer` attribute fallback in request parsing was removed; dead base64 try/catch removed; the fixed
    `PasswordProtectedTransport` AuthnContextClassRef is documented as intentional (password-only scope).
  - _Identity stores_: the store interface's `upsert*` methods now return the full row (the external store
    returned bare `{id}` against a richer local implementation); `pgSchema` is **finally wired** — the pg
    pool sets `search_path` (and schema bootstrap creates the schema) so external tables can live outside
    `public`, with identifier validation on the DTO; external schema init is transactional (no more
    half-init misclassified as a foreign DB); the circuit-breaker `state` getter no longer reports
    `half-open` below the trip threshold; boot-activation failure now records `reachable=false`; dead
    `markConnected` spread/param removed; deleting a user terminates its SSO sessions with a new dedicated
    `user_deleted` reason (was: `user_deactivated`); identity list filters validate `apiConnectionId`
    (garbage → 400, not a silently empty page).
  - _IdP settings / certs_: an unparseable active cert now logs a warning during auto-rotation evaluation
    (was: silently never rotates); manual complete/cancel rotation take the auto-rotation in-flight guard
    (409 instead of racing the auto driver), and auto-complete re-checks pending state on its fresh read
    (a vanished rotation is a no-op, not a null-overwrite of the active cert); EC encryption uploads get a
    real ECDH key-agreement probe (mirroring the RSA encrypt/decrypt probe — ECDH-ES is supported
    end-to-end); rotation notifier calls are awaited and error-guarded (a throwing notifier can no longer
    break the scheduler tick).
  - _Auth / common / shared_: `SESSION_SECRET` fails closed (boot `@MinLength(16)` validation + both
    session services throw on an empty secret instead of HMAC-ing with `''`); the end-user session TTL is
    clamped (90-day ceiling, mirroring the admin clamp); end-user logout is audited; an operator password
    reset clears the target's lockout (a locked-out admin no longer stays locked after a reset); the
    lockout-reset best-effort delete logs its failure instead of swallowing it; the IP-ban audit records
    the real observed trip count (was: always the configured threshold); initial-admin bootstrap is audited
    (`admin_user_bootstrapped`); the timing-equalisation dummy bcrypt hash follows the configured cost
    factor; password DTOs cap at bcrypt's 72-byte input limit (login/rotation paths for legacy hashes
    deliberately keep their old bounds); audit `since`/`until` validate as ISO-8601; `ParseCuidPipe` is
    lowercase-only and length-bounded (a 10 KB "id" no longer reaches the DB); a global
    `RedactingExceptionFilter` deep-redacts secrets in every outgoing HTTP error payload (§B10's last
    piece); the SP certificate is parsed with `X509Certificate` at upload (was: substring sniffing — a
    structurally broken cert failed later at SSO time); dead `requireHttps` option, four dead `@deprecated`
    shared stubs and a `while`-that-was-an-`if` in `validateProxyUrl` removed.
- **Back-channel notifier hooks can no longer corrupt the delivery state machine** — the
  logout-propagation notifier calls were bare (`void this.notifier.onSent(...)`): an async rejection
  became a process-level unhandled rejection, and a notifier throwing synchronously from `onSucceeded`
  was caught by the delivery wrapper which then flipped an **already-succeeded** row to `failed` (with a
  duplicate audit). All four hooks now go through a `notifySafe` wrapper (sync throw + async rejection
  both logged as `backchannel_notifier_error`, never escalated). Found by the new `BC-NOTIF-*` suite.
- **Multi-write operations made atomic** (§14): `completeSso`'s participation-create + one-time SAML-session
  delete now run in one transaction (a crash between them could leave a replayable pending session or an SSO
  session invisible to SLO fan-out), `purgeExpiredSessions` deletes pending sessions, expired SSO
  sessions and stale replay-log rows in one transaction — returning the **full** purged count (previously
  only the pending-session count was reported) — and `ensureSigningMaterial`'s first-use generation uses an
  atomic conditional claim (two concurrent first-use callers can no longer both persist material, which
  could publish a cert that doesn't match the actually-stored signing key; losers now adopt the winner's
  pair — `API-SAML-SIGN-RACE-01`). The full sweep — every multi-write that must be atomic, its mechanism,
  its proving test, and the one documented exception (`importSnapshot`, idempotent re-runnable streaming) —
  is catalogued in the new `docs/transactional-integrity.md`.
- **Admin SPA small correctness fixes** (§5.C, web batch): the external-DB, SAML-sessions and
  API-connections pages no longer toast raw `error.message` (all error paths now flow through
  `mapAdminError`, with five new `externalDb.*Failed` fallback keys across all 10 locales); the audit log
  gained offset-based pagination (Previous/Next + page indicator — entries beyond the first 50 were
  unreachable) and lost a dead `getCsrfToken()` expression; the sync-page log-source filter got an
  out-of-order response guard (a slow earlier response can no longer overwrite a newer selection); the dead
  `ConfirmDialog.confirmDisabled` prop was removed; and `TextInput` now renders a translated required
  suffix (`common.required`), sets `aria-required`, and falls back to `useId()` so duplicate labels can't
  produce colliding input ids.
- **"Sync all" parallelism no longer breaks collision determinism** (§B3) — the "first connection
  (createdAt order) wins a cross-source username collision" guarantee only holds when sources run
  sequentially, but `SYNC_ALL_CONCURRENCY` could be raised to 16 and silently produce a racy winner.
  Concurrency > 1 is now honoured only when **every** included connection uses the `fail_run` collision
  policy (a collision then fails the run loudly instead of picking a nondeterministic winner); otherwise
  the configured value is clamped to 1 with a warning. Documented in `.env.example` + `docs/deployment.md`.
- **"Sync all" no longer hides opted-out sources** (§B3) — the `excluded` total was hardcoded `0`. Non-local
  API connections with `includeInSyncAll: false` are now counted and emitted as `excluded` per-connection
  results (status `excluded`, never contacted), so they're visible in the summary instead of silently dropped.
- **Auto-rotation projection honours operator env overrides** (§B9) — the IdP settings DTO's
  `willAutoStartBy` / `willAutoCompleteAt` were computed from the default lead/overlap-day constants, so the
  displayed "will auto-start/complete by" dates were wrong whenever an operator overrode the per-cert
  `CERT_ROTATION_*_LEAD_DAYS` / `_OVERLAP_DAYS` knobs. The service now threads the resolved per-kind
  `CertRotationConfig` windows into the mapper (defaulting to the shared constants when none is supplied).
- **Concurrency races made atomic** (with real-libSQL regression tests): the per-account lockout counter
  (atomic `increment` instead of read-then-write), the last-admin/self delete guard (count-after-delete in a
  transaction — can no longer drop the system to zero admins), and the SAML session→user bind (atomic
  conditional `updateMany` — exactly one concurrent login wins).
- **Active SAML sessions "Source" filter works** — `listSamlSessions` now serialises `apiConnectionId` into
  the request (the admin filter was a silent no-op).
- **API-connection creation is audited** — `create()` now emits the `api_connection_created` event.
- **Mirror-mode source removal flags drift** — `removeConnectionIdentities` was missing from the mirroring
  store's mutating-method set, so removing a source in mirror mode silently diverged the external copy.
- **Back-channel SLO**: `partial` deliveries are now pruned (terminal, not a leak), an operator resend resets
  the retry counter, and failed-delivery backoff has jitter (no synchronised retry herd against a down SP).
- **OAuth token cache invalidation** — deleting or updating an API connection now evicts its cached token /
  in-flight exchange / last-token timestamp (`OAuthTokenService.invalidate`).
- **OAuth token cache: no decrypt on hit + `forceRefresh` single-flight** (§B13) — the cache key is now
  derived from the _encrypted_ client-secret blob, so a cache hit no longer decrypts the stored secret on
  every sync request (re-encryption of the same secret is a conservative miss, never a stale hit); and
  `forceRefresh` now joins an already-in-flight exchange instead of starting a competing one (the in-flight
  exchange already returns a brand-new token), eliminating the double token-endpoint hit and the orphaned
  in-flight entry it left behind.
- **Sync runs are self-describing on failure** — an unexpected throw in the membership/deactivation phase now
  records an `internal` error entry instead of producing a `FAILED` log with no explanation.
- **Boot/runtime hardening** — `app.enableShutdownHooks()` (clean Prisma `$disconnect` + interval cleanup on
  SIGTERM), a numeric `PORT` guard, an explicit 1 MB body-size limit (resolving the 256 KB SLO-metadata DTO
  vs. 100 KB default conflict), an empty-NameID guard in the SAML attribute mapper, and `ENCRYPTION_KEY`
  minimum-length validation at boot.

## [1.18.0]

### Added

- **Multiple API connections for sync (Prompt 37):** the operator can register **several** external API
  connections and sync from all of them into the **one shared** User/Group/Role store, where every synced
  record is tagged with the `apiConnectionId` of the source it came from. The single-connection cap is
  lifted; manual per-connection "Sync now", a new **"Sync all sources"** bulk trigger, and the scheduler all
  feed the shared store.
- **"Sync all sources":** `POST /api/admin/sync/all` runs every included non-local connection with **bounded
  concurrency** (`SYNC_ALL_CONCURRENCY`, default sequential), supports a **dry-run** cross-source preview,
  skips in-progress connections, isolates failures, and returns a per-connection summary. A per-connection
  **include-in-sync-all** toggle keeps a source registered but out of bulk runs.
- **Username-collision policy:** `User.username` stays globally unique (login stays deterministic); a
  cross-connection overlap is **skipped + reported** by default (the run stays `SUCCESS`, the owner is named,
  the collision is counted in `SyncLog.usersSkippedCollision` and audited), with a deterministic winner
  (earliest `createdAt`) and an opt-in strict `fail_run` policy (`SYNC_USERNAME_COLLISION_POLICY` + a
  per-connection override). The DB unique constraint is the final arbiter under concurrent races (`P2002`
  is converted to a collision, never a crash).
- **Surfacing:** the dashboard lists **all sync sources** (per-source status/counts) plus a **stale/failing
  sources** warning widget; the API-connections list shows per-source synced counts + last-collision count;
  identity Users/Groups/Roles lists gain a **source filter + label** (and a `/identity/sources` endpoint);
  Active SAML sessions can be filtered by the signed-in user's originating source.
- **Source-removal lifecycle:** removing a sync source's identities (`deactivate`|`delete`, bounded batches)
  terminates the removed users' active SSO sessions (back-channel SLO fans out) before the connection can be
  deleted; re-pointing a connection's `baseUrl`/contract with existing identities requires acknowledgement.

### Changed

- **Membership-within-source invariant:** a user may only belong to groups/roles of its own
  `apiConnectionId` (enforced in the store + admin validation; sync already upheld it). Cross-source overlay
  membership is out of scope.
- Additive schema (migration `20260616120000_multi_source_sync`): `ApiConnection.includeInSyncAll`,
  `ApiConnection.usernameCollisionPolicy`, `ApiConnection.lastCollisionCount`,
  `SyncLog.usersSkippedCollision`. No change to the identity model or to `User.username`'s global `@unique`.
- New bounded env knobs `SYNC_USERNAME_COLLISION_POLICY`, `SYNC_ALL_CONCURRENCY`, `SYNC_SOURCE_STALE_FACTOR`.

## [1.17.0]

### Added

- **Back-channel (SOAP) Single Logout + multi-SP propagation (Prompt 36):** terminating an end-user SSO
  session — operator kill (single, **bulk multi-select**, per-user, or a **terminate-all** kill-switch),
  user logout, or an SP-initiated `/saml/slo` — now **propagates a signed SAML `LogoutRequest` to every
  other participating Service Provider over the SOAP back-channel** (server-to-server), logging the user
  out everywhere. Logout is authoritative locally and never blocked: propagation is best-effort with a
  persistent retry queue (`SamlBackchannelLogout`) + an in-process retry/prune scheduler that survives
  restarts. The SP-initiated initiator is answered front-channel and never back-channelled.
- **Operator controls (API):** bulk `POST /api/admin/saml-sessions/terminate` `{ids}`, `terminate-all`,
  per-delivery `resend-backchannel`, on-demand `process-backchannel`, and a `backchannel-health` queue
  summary.
- **Per-SP SOAP SLO config:** `SpConnection.sloSoapUrl` (back-channel fires only when set; requires the
  SP certificate to verify the SP's LogoutResponse) + a `lastBackchannelLogout*` degraded indicator.
- **Robustness & observability:** idempotent delivery (stable reused request ID), `PartialLogout`
  handling, configurable validity/clock-skew, per-SP serialization + a global in-flight cap, exponential
  backoff with give-up + SP-degraded escalation, audit events (`saml_backchannel_logout_*`, system actor)
  - structured logs, and a no-op `LogoutPropagationNotifier` hook for alerting.
- **Admin UI:** the Active Sessions page gains row checkboxes + "select all active" + **"Terminate
  selected"** and **"Terminate all active"**, a per-session **back-channel propagation indicator** (per-SP
  status + "resend" for failed/given-up deliveries), and a queue-health callout with **"process now"**. The
  SP form gains a **SOAP SLO endpoint** field (with HTTPS / cert-required validation), metadata autofill of
  the SOAP `SingleLogoutService`, and a **"Test back-channel SLO"** probe button. The dashboard surfaces a
  **count of sessions with unresolved back-channel logouts**. All new strings in **all 10 locales**.

### Changed

- `SamlSsoSessionService.terminate()` is the single choke-point that fans out propagation (via a decoupled
  `LOGOUT_PROPAGATION_PORT`, provided by a `@Global` module to avoid a module cycle); it gains an options
  arg to exclude the SP-initiated initiator.
- New `SamlBackchannelLogout` table + `SpConnection` SOAP/degraded columns (migration
  `20260615120000_backchannel_slo`).
- New bounded env knobs `SAML_BACKCHANNEL_LOGOUT_*` (scheduler tick `0` disables retries; HTTP timeout,
  max retries, backoff, concurrency, in-flight cap, first-pass budget, validity, prune).

### Security

- **Strict SP-only end-user login — no standing IdP session (Prompt 36, Deliverable 10):** NestIdP is
  strictly SP-facing and the end user is never a "logged-in" portal user. `/login` now renders the login
  form **only** when there is a live pending SSO request; otherwise it shows a neutral "access NestIdP
  through your application" notice (no form, no username field, no session indicator). After the assertion
  is delivered (`complete-sso`), the `nestidp_user_session` browser cookie is **cleared** (the
  `SamlSsoSession` registry entry stays active for SLO/admin visibility). `GET /api/auth/session` no longer
  leaks identity without a valid pending request (`authenticated:false`, no username). The SP-initiated SSO
  flow itself is unchanged.

## [1.16.0]

### Added

- **Rate limiting & brute-force protection (Prompt 35):** a unified, three-dimension protection layer for
  the login surfaces. A shared sliding-window core backs the per-IP / per-username **throttle**; a new
  persistent, per-account **lockout** (DB-backed `LoginLockout` table) locks an account after N consecutive
  failures with exponential backoff and **guaranteed time-based recovery** (never permanent — the last
  admin can always get back in); and a cross-endpoint per-IP **escalation/ban** catches distributed
  attacks that stay under any single window. Applies to admin login, end-user login (incl.
  `complete-sso`), and — closing a gap — the public `GET`/`POST /saml/sso` endpoint.
- **Operator controls & safety:** a configurable **response mode** (`retry_after` default with
  `Retry-After`, or `opaque` 401 with zero lockout disclosure — both no-enumeration), a **trusted-CIDR
  bypass** for internal/monitoring IPs (throttle + ban only, never account lockout), an optional in-process
  **tarpit** delay, automatic **lockout clear on credential change** (admin password change + end-user
  re-sync with a new hash), and a periodic **prune** of stale lockout rows.
- **Observability & integration:** every lock / throttle / ban / unlock is audited (`*_login_locked`,
  `*_login_rate_limited`, `saml_sso_rate_limited`, `login_ip_banned` as **system** actor;
  `*_account_unlocked` as **admin**) **and** emits a structured JSON log line for SIEM; a no-op
  `BruteForceNotifier` hook ships for wiring alerting later.

### Changed

- The admin login limiter is now **configurable and per-username** (parity with the end-user limiter),
  and the four bespoke in-memory limiters are unified behind one tested sliding-window core.
- New `LoginLockout` table (migration `20260614120000_rate_limit_brute_force`; existing rows unaffected —
  the table starts empty).
- New bounded env knobs: `LOGIN_LOCKOUT_THRESHOLD` (+ per-scope `ADMIN_`/`END_USER_` overrides),
  `LOGIN_LOCKOUT_BASE_MS`, `LOGIN_LOCKOUT_MAX_MS`, `LOGIN_LOCKOUT_RESPONSE_MODE`,
  `LOGIN_LOCKOUT_PRUNE_INTERVAL_MS`, `ADMIN_LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS` / `_USERNAME_MAX` /
  `_USERNAME_WINDOW_MS`, `SAML_SSO_RATE_IP_MAX` / `_WINDOW_MS`, `LOGIN_IP_BAN_THRESHOLD` / `_WINDOW_MS` /
  `_MS`, `RATE_LIMIT_TRUSTED_CIDRS`, `LOGIN_TARPIT_BASE_MS`.

### Security

- Brute-force lockout is opt-out (on by default with conservative thresholds), persists across restarts,
  and surfaces locked accounts in the admin console with a manual unlock action. No secrets or account
  enumeration in HTTP responses; lock/ban specifics live only in the audit log and structured logs.

## [1.15.0]

### Added

- **Automatic certificate rotation (Prompt 34):** an operator can opt a signing and/or encryption
  certificate into a **hands-off rotation lifecycle**. An in-process scheduler starts a rotation when
  the active cert nears expiry (publishing the existing **dual-cert overlap** in IdP metadata so SPs can
  pre-trust the new key) and **auto-completes** it after a configurable overlap window. Signing and
  encryption rotate **independently**; opt-in, **off by default**, single-instance, and state survives
  restarts. Existing deployments keep rotating manually, unchanged.
- **On-demand check** `POST /api/admin/idp/settings/cert-rotation/run-check` forces one evaluation
  (honours dry-run), and a **"due soon" pre-notification** fires ahead of the auto-start window via a
  `CertRotationNotifier` hook (no-op by default, wireable to alerting).
- **Operator safety:** per-cert failure backoff that auto-disables after N consecutive failures,
  a **dry-run** mode that audits/notifies without mutating, **boot-grace** to avoid surprise rotations
  right after a deploy, **jitter**, an **overlap-fits-before-expiry** clamp, per-cert lead/overlap
  overrides, and `lastAutoRotationCheckAt` / `lastAutoRotationActionAt` observability.
- Admin UI: an **Automatic rotation** panel on IdP settings (per-cert toggles, computed
  will-start/will-complete hints, backoff banner, dry-run indicator, "Run rotation check now"); full
  strings in all 10 locales.
- Audit events `idp_{signing,encryption}_rotation_auto_started` / `_auto_completed`,
  `_auto_rotation_failed` / `_due_soon` / `_autodisabled` (system actor), plus
  `idp_auto_rotation_setting_changed` / `idp_auto_rotation_check_run` (admin actor) — no key material.

### Changed

- `IdpSettings` gains `autoRotate{Signing,Encryption}Enabled`, `lastAutoRotationCheckAt` /
  `lastAutoRotationActionAt`, and per-cert auto-rotation failure-backoff columns (migration
  `20260613120000_automatic_certificate_rotation`; existing rows default to auto-rotation off).
- New bounded env knobs: `CERT_ROTATION_SCHEDULER_TICK_MS` (`0` disables), `CERT_ROTATION_LEAD_DAYS`,
  `CERT_ROTATION_OVERLAP_DAYS` (+ per-cert overrides), `CERT_ROTATION_VALIDITY_DAYS`,
  `CERT_ROTATION_NOTIFY_LEAD_DAYS`, `CERT_ROTATION_JITTER_MAX_SECONDS`, `CERT_ROTATION_BOOT_GRACE_HOURS`,
  `CERT_ROTATION_FAILURE_AUTODISABLE_THRESHOLD`, `CERT_ROTATION_DRY_RUN`.

### Security

- Auto-rotation reuses the existing encrypted-at-rest key path; private keys are never serialized to the
  frontend or logged, and failure reasons are redacted. The scheduler is single-instance (documented);
  a misconfigured/unparseable cert never crashes a tick or blocks boot.

## [1.14.0]

### Added

- **Outbound HTTP proxy per API connection (Prompt 33):** an operator can route a single API
  connection's outbound sync traffic through a corporate **HTTP/HTTPS proxy**, configured per
  connection from the admin console. When enabled, **all** outbound calls for that connection — the
  identity sync fetches (users/groups/roles), the OAuth token-endpoint exchange, and the
  "Test connection" / "Test token" diagnostics — traverse the proxy. Proxy is **per connection, off by
  default**; existing deployments connect directly with no change.
- **`noProxyHosts` bypass list** supporting exact host, `host:port`, leading-dot domain suffix, `*`
  (everything), **IPv4/IPv6 CIDR ranges** (`10.0.0.0/8`, `fd00::/8`, dependency-free), and always
  `localhost`/`127.0.0.1`/`::1` (case-insensitive).
- **Dedicated "Test proxy" diagnostic** (`POST /api/admin/api-connections/:id/test-proxy`) that probes
  **only the proxy hop**, so an operator can tell "proxy is dead / rejects auth" apart from "target is
  down". Persists a proxy-health status (`lastProxyCheckStatus`/`lastProxyCheckAt`) surfaced as a badge.
- **Proxy error taxonomy** — failures are classified into `auth_failed` (HTTP 407), `unreachable`,
  `tunnel_failed`, `tls_error`, `target_error`, and `bypassed`, so a proxy is never blamed for a target
  outage (or vice versa).
- **Effective-routing preview** in the admin form: a live, client-side `direct` / `via proxy` summary
  per known target (sync base URL + OAuth token URL) to validate the bypass list before saving.
- New audit events `api_connection_proxy_updated` and `api_connection_proxy_checked` (no secrets —
  enabled/disabled, proxy host, whether auth is set, no-proxy presence, check status).
- Full proxy UI strings in all 10 locales (`en, cs, sk, de, fr, es, pl, it, pt, nl`).

### Changed

- Added `undici` (v6, pure-JS, Node 20 / `node:20-slim`-compatible) to `apps/api`; a per-connection
  `undici` `ProxyAgent` is threaded into each `fetch(...)` as the dispatcher. `AbortSignal.timeout`
  still bounds every request; a separate bounded `connectTimeout` fast-fails a dead proxy.
- `ApiConnection` gains `proxyEnabled`, `proxyUrl`, `proxyUsername`, `proxyPasswordEncrypted`,
  `noProxyHosts`, `lastProxyCheckStatus`, `lastProxyCheckAt` (migration
  `20260612120000_outbound_http_proxy`; existing rows default to proxy-off).

### Security

- The proxy password is stored **only** in the encrypted libSQL database, **encrypted at rest** via the
  existing `CREDENTIALS_ENCRYPTION` port, **never** returned to the frontend (`hasProxyPassword`
  boolean + write-only `proxyPassword` input), and **never** logged.
- Secret redaction extended to cover the `Proxy-Authorization` header and inline credentials embedded in
  a proxy URL (`http://user:pass@host` → `http://[redacted]@host`).
- The existing off-origin SSRF guard runs **before** dispatcher selection — a proxy cannot reach a
  target the direct path would reject. `ProxyAgent` pools are cached per connection and closed cleanly
  on config change, delete, and shutdown (no leaks).

## [1.13.0]

### Added

- **Scheduled identity sync (Prompt 32):** an operator can schedule **automatic identity syncs** per
  API connection with a **cron expression + IANA timezone**, configured from the admin console.
  Scheduling is **opt-in and off by default**; existing deployments are unchanged.
  - **In-process scheduler** (`SyncSchedulerService`) following the existing periodic-task convention
    (single `setInterval`, no `@nestjs/schedule`). One ticking timer reads fresh DB state each tick,
    triggers due connections through the existing `SyncService.triggerSync`, persists `nextRunAt` so
    schedules **survive restarts**, never **double-runs** (pre-checks the concurrency guard, treating a
    stale run as reclaimable), does **not catch up** missed slots, and isolates per-connection failures.
    Single-instance appliance only (no HA leader election).
  - **Shared cron contract** (`packages/shared/schedule.ts`) backed by `cron-parser`: `validateCronSchedule`,
    `nextCronRuns`/`nextCronRun`, a **minimum-interval guard** (`SYNC_SCHEDULE_MIN_INTERVAL_MINUTES`,
    default 5), IANA timezone + DST validation, and named **presets** shared by API and UI.
  - **`triggerSource`** (`manual` | `scheduled`) on `SyncLog` distinguishes automatic runs; scheduled
    runs are audited as a **system** actor. Sync-log history can be **filtered by source** in the API + UI.
  - **Admin API:** `GET`/`PATCH /api/admin/sync/:id/schedule` (enable/cron/timezone/pause/dry-run, with
    a next-runs preview) and `GET /api/admin/sync/schedules/overview`. Schedule changes emit a
    `sync_schedule_updated` audit event (no secrets).
  - **Admin UI:** a **Schedule** section on the sync page (enable, preset/cron, timezone, live preview of
    the next runs in both the schedule timezone and the operator's local timezone, pause, dry-run,
    **Run now**, and a status row), a **Schedules overview** page, a compact dashboard summary, and
    manual-vs-scheduled labels in sync history. Full strings in all 10 locales.
  - **Hardening:** schedule **jitter** to spread same-cron connections (`SYNC_SCHEDULE_JITTER_MAX_SECONDS`),
    **pause** (keep schedule, skip runs) distinct from disable, optional **dry-run** schedules,
    **failure backoff / auto-pause** after N consecutive failures (`SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD`),
    configurable **on-boot overdue grace** (`SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES`), **stale-run reclaim**
    so a hung scheduled run never blocks future slots, an extensible no-op **`ScheduledSyncNotifier`** hook
    point for future failure delivery, and scheduler state surfaced in **`/ready`**.
  - New env: `SYNC_SCHEDULER_TICK_MS` (default 30000, `0` disables), `SYNC_SCHEDULE_MIN_INTERVAL_MINUTES`,
    `SYNC_SCHEDULE_JITTER_MAX_SECONDS`, `SYNC_SCHEDULE_FAILURE_AUTOPAUSE_THRESHOLD`,
    `SYNC_SCHEDULE_BOOT_OVERDUE_GRACE_MINUTES`.

### Changed

- `ApiConnection` gains schedule columns (`scheduleEnabled`, `scheduleCron`, `scheduleTimezone`,
  `schedulePaused`, `scheduleDryRun`, `nextRunAt`, `lastScheduledRunAt`, `lastScheduledRunStatus`,
  `scheduleLastError`, `scheduleConsecutiveFailures`, `scheduleAutoPausedAt`) and `SyncLog` gains
  `triggerSource` (migration `20260611120000_scheduled_sync`). A successful real sync now clears any
  scheduled-failure backoff/auto-pause state for the connection.

## [1.12.0]

### Added

- **External identity database (Prompt 31):** identity entities (`User`, `Group`, `Role` + memberships)
  can be attached at runtime to an external **PostgreSQL or MySQL** database from the admin console.
  System/config data (admins, IdP settings, certs, SP/API connections, audit, sessions) always stays
  in the local encrypted libSQL file.
  - **Two modes via one toggle** ("keep a copy locally", default **off**): **relocate** — identity is
    moved to the external DB which becomes authoritative and the local identity rows are deleted; or
    **mirror** — local stays authoritative and the external DB receives a synchronized copy.
  - **IdentityStore abstraction** + a runtime-swappable `ActiveIdentityStore` holder: every identity
    consumer (login, SAML assertions, inbound sync, identity-admin CRUD, dashboard) goes through it,
    so the active store can be hot-swapped with **no restart**. Local impl uses Prisma/libSQL; the
    external impl uses **Kysely** (Prisma stays single-provider on libSQL).
  - **Attach flow** (admin API + UI): test connection, **preview** (ownership empty/ours/foreign +
    create/update diff counts + conflict detection, no writes), then connect — ensure the
    `nestidp_`-prefixed schema (versioned migrator), import the snapshot, verify, and in relocate mode
    **back up the local DB and wipe local identity only with an explicit acknowledgement**. Disconnect
    offers a reverse migration (external → local) before detaching.
  - **Hardening:** circuit breaker + per-query timeout (a slow/unreachable external DB fails fast and
    never hangs login/SAML), background liveness probe, TLS (`sslMode` + optional CA), pool sizing,
    single-flight lock for connect/resync/disconnect, and a cross-store guard that blocks deleting an
    `ApiConnection` while identity rows for it still exist in the active store.
  - **Admin API** `POST/GET/DELETE /api/admin/identity-database` (+ `/test`, `/preview`, `/resync`),
    a new admin page (Settings → External database) in all 10 locales, and `/ready` now reports the
    external DB status (degrading to 503 when an active relocate-mode DB is unreachable).
  - **Security:** the DB password is encrypted at rest with `EncryptionService`; DSN/password never
    logged or returned (`hasPassword` only). The external DB is **not** covered by the local at-rest
    encryption — the UI and docs state this is the operator's responsibility.

### Changed

- `pnpm db:new-migration` now runs `prisma migrate dev --skip-seed` (the auto-seed failed under
  ts-node ESM after authoring the SQL).

## [1.11.0]

### Changed

- **Single encrypted libSQL datastore — PostgreSQL removed (Prompt 30):** the dual-provider
  (`sqlite` / `postgresql`) Prisma setup is replaced by **one encrypted libSQL file** opened through
  **`@prisma/adapter-libsql`** with an at-rest `encryptionKey`. PostgreSQL is removed entirely from
  runtime, Docker, CI, and tests. The whole identity store is now one file on a mounted volume.
  - **`DATABASE_URL`** must be a `file:` URL. New **`DATABASE_ENCRYPTION_KEY`** (or
    **`DATABASE_ENCRYPTION_KEY_FILE`**, mutually exclusive) sets the at-rest key — **required in
    production**, optional in development (unset → plaintext file for easy inspection). This is
    independent of the app-layer `ENCRYPTION_KEY` used for secret columns.
  - **`DATABASE_PROVIDER`** is gone; `validateDatabaseUrl` now accepts only `file:` URLs.
  - **Startup migrator** (`apps/api/src/prisma/db-migrator.ts`): because Prisma's bundled SQLite
    engine and the `prisma migrate` CLI cannot open an encrypted libSQL file, the API applies pending
    migrations itself through the keyed adapter before listening. Migrations are tracked in
    `__app_migrations` (name + checksum), applied as one atomic `BEGIN IMMEDIATE` batch, with
    **checksum-drift detection** and an integrity check that distinguishes a wrong key from a corrupt
    file. **`MIGRATE_ONLY=1`** migrates and exits (init-container/job pattern).
  - **Single migration history** under `prisma/migrations/` (sqlite dialect). The per-provider
    `migrations-sqlite/` and `migrations-postgresql/` folders and the `prisma:prepare` /
    `sync-prisma-provider` machinery are removed.

### Added

- **Migration & ops tooling:** `pnpm db:new-migration` authors SQL via `prisma migrate dev` against an
  unencrypted scratch DB; `pnpm db:migrate:deploy` applies pending migrations through the adapter; and
  a `db-cli.mjs` helper provides `pnpm db:rekey` (`PRAGMA rekey` in-place re-encrypt), `pnpm db:backup`
  (`VACUUM INTO` encrypted copy), `pnpm db:dump`, and `pnpm db:restore`.
- **Tests:** encrypted round-trip / wrong-key / no-key / raw-bytes specs, rekey and backup specs, and
  migrator specs (idempotency, ordering, atomic rollback, drift, encrypted DB). Each integration spec
  applies migrations to its own temp libSQL file via the in-process migrator — no external DB, no
  `prisma migrate deploy` in the test path. Postgres smoke specs and `POSTGRES_TEST_URL` are removed.

### Removed

- PostgreSQL service from `docker-compose.yml` / `docker-compose.dev.yml` and the Postgres service
  container + `POSTGRES_TEST_URL` from CI. Docker images now mount a `data/` volume and pass
  `DATABASE_URL` + `DATABASE_ENCRYPTION_KEY`; the entrypoint no longer runs `prisma migrate deploy`
  (migrations run at startup).

## [1.10.0]

### Added

- **OAuth 2.0 Client Credentials for API connections (Prompt 29):** an API connection can now
  authenticate to the external identity API via the OAuth 2.0 Client Credentials grant
  (`AuthType.OAUTH2_CLIENT_CREDENTIALS`) instead of a static Bearer token. `BEARER` remains the
  default and existing connections are unchanged.
  - **Token exchange** at a configurable token endpoint: `client_secret_post` (body) or
    `client_secret_basic` (HTTP Basic), optional `scope` / `audience`, and optional fixed extra
    token-request params (`oauthTokenRequestParams`, validated like the Prompt 27 query params with
    reserved OAuth names rejected).
  - **In-memory token cache** keyed by the resolved config (URL/clientId/scope/audience/auth method/
    params/secret hash) with a refresh skew; **single-flight** so concurrent membership fetches make
    one token request; `expires_in` is clamped to sane min/max bounds; only a `Bearer` `token_type`
    is accepted.
  - **Sync** resolves the access token, and on a `401` during the users fetch refreshes once and
    retries before failing the run with a clear `oauth` error.
  - **Test connection** probes the token endpoint first (with a distinct TLS-error message) and a new
    **`POST /api/admin/api-connections/:id/test-token`** action returns masked diagnostics
    (`tokenType` / `expiresIn` / `grantedScope`) — never the token.
  - **Admin form** adds an authentication-type selector with conditional OAuth fields (token URL,
    client id, client secret [write-only, "leave blank to keep"], scope, audience, client auth method,
    extra params) and a **Test token** button. New `apiConnections.auth*` / `oauth*` strings in all
    10 locales.
  - New audit events `api_connection_auth_type_changed`, `api_connection_oauth_token_obtained`, and
    `api_connection_oauth_token_failed` (no secrets in metadata). Read-only `oauthLastTokenAt` is
    surfaced on the connection DTO.
  - Schema: `ApiConnection` gains nullable `oauthTokenUrl` / `oauthClientId` /
    `oauthClientSecretEncrypted` / `oauthScope` / `oauthAudience` / `oauthClientAuthMethod` /
    `oauthTokenRequestParams`, and `AuthType` gains `OAUTH2_CLIENT_CREDENTIALS` (migration in both
    dialect dirs).

### Changed

- Secret redaction (`redactSecrets`) now also scrubs `client_secret`, `access_token`, and
  `Authorization: Basic/Bearer` values from any error/log path.
- The create/update DTO `bearerToken` is now optional and only required for `BEARER` connections; the
  service validates credentials per auth type.

### Security

- The OAuth client secret is stored encrypted, never returned to the SPA (only `hasOauthClientSecret`),
  and never logged. The token endpoint URL is validated (absolute http(s), no embedded credentials).
  Rotating the secret transparently invalidates the cached token (the secret is part of the cache key).

## [1.9.0]

### Added

- **Configurable API contract per connection (Prompt 27):** identity sync can now target arbitrary
  REST APIs without code changes, via a new optional `ApiConnection.apiContractConfig` (JSON; `null` ⇒
  the fixed v1 contract, so existing connections are unchanged). Configurable per connection:
  - **Endpoint paths** for users / user-groups / user-roles (path templates with an `:id` placeholder).
  - **JSON field mapping** to the canonical fields, including nested dot-paths (e.g. `profile.login` →
    `username`, `credentials.hash` → `passwordHash`); group/role `id`/`name` maps.
  - **Response envelope** (`responseRoot` dot-path to the array) and fixed **query params**.
  - **Extra request headers** (non-secret; `Authorization` is reserved).
  - **Bounded pagination** (offset or page mode, with `pageSize`/`maxPages` caps).
  - **Embedded memberships** — read groups/roles from the user payload instead of per-user endpoint
    calls (avoids N+1); endpoint-mode N+1 fetches are bounded by `SYNC_MEMBERSHIP_FETCH_CONCURRENCY`.
  - **Status→active mapping** (`trueValues` / `inverted`), **field defaults** (`displayNameFromUsername`,
    default `email`, plus the existing password-hash algorithm constant), and per-user membership caps
    (`maxGroupsPerUser` / `maxRolesPerUser`, env fallbacks `SYNC_MAX_GROUPS_PER_USER` / `SYNC_MAX_ROLES_PER_USER`).
  - **Row-error policy** — `skip` (default; record + continue, matching v1) or `fail` (abort the run).
- **Contract-aware Test connection** — `POST /api/admin/api-connections/:id/test` now reports the parsed
  user count, a preview of the first mapped users (password hash never returned), the first mapping/
  validation error (canonical field + source path), and per-collection (groups/roles) reachability.
- **Admin form** — collapsible "API contract (advanced)" section with a JSON editor, starter **presets**
  (`generic` / `keycloak-like` / `auth0-like`, shared `API_CONTRACT_PRESETS`), and reset-to-default.
- New shared module `@nestidp/shared/api-contract`: `ApiContractConfig`, `ResolvedApiContract`,
  `DEFAULT_API_CONTRACT`, `resolveApiContract`, `assertValidApiContractConfig`, safe `getByPath`
  (ignores prototype keys), and `API_CONTRACT_PRESETS`. Contract paths are validated to be
  origin-relative (no absolute/`//`/`..` paths) and re-checked in the sync client.
- New audit event `api_connection_contract_updated`; new `apiConnections.contract*` i18n strings in all
  10 locales. Sync flow diagram updated for the contract/embedded/pagination paths.

### Changed

- The mapping layer runs for the default (identity) contract too, so its only behavioural delta vs v1 is
  an intentional **strict superset**: `active` now also accepts `'true'`/`'false'`/`'1'`/`'0'`/`1`/`0`
  (previously strict boolean). No previously-valid row becomes invalid.
- The sync orchestration was restructured into map→upsert→(bounded-parallel membership fetch)→apply
  phases to support embedded memberships and concurrency while keeping counters deterministic.

### Fixed

- Test support typings updated for the new `ApiConnection.apiContractConfig` column so the suite
  type-checks against a freshly generated Prisma client (CI): the `createTestApiConnection` override
  type now exposes `apiContractConfig` as `Prisma.InputJsonValue` (Prisma create inputs reject the
  nullable `JsonValue`), and the `sync.mapper` fixture includes the now-required `apiContractConfig`
  field. No runtime behaviour change.
- PostgreSQL integration spec `sync.postgres.integration.spec.ts` updated to the renamed sync-client
  methods (`fetchGroupsRawForUser` / `fetchRolesRawForUser`) introduced in v1.9.0. The file only runs
  in the Postgres CI job, so the stale method names were not caught by the local SQLite test pass.

## [1.8.0]

### Added

- **SAML Single Logout — SP-initiated (Prompt 26):** `GET/POST /saml/slo` now accept a `<samlp:LogoutRequest>`
  over the HTTP-Redirect and HTTP-POST bindings (previously a 501 stub). The IdP validates Destination,
  IssueInstant clock skew, and the optional `NotOnOrAfter`; verifies the signature (detached query signature
  for Redirect, enveloped XML-DSig for POST); terminates the matching IdP SSO session (**single-SP scope —
  no propagation to other SPs**); and returns a signed `<samlp:LogoutResponse>` to the SP's `sloUrl` over the
  same binding. When `sloUrl` is absent the browser is redirected to a localized `/logged-out` page. The IdP
  metadata now advertises `<md:SingleLogoutService>` (HTTP-POST + HTTP-Redirect) at `/saml/slo`.
- **Revocable server-side SSO sessions:** new `SamlSsoSession` + `SamlSpParticipation` models. A session row is
  created at end-user login (its id becomes the cookie `sid`), and a participation row (carrying the emitted
  `SessionIndex` + NameID) is created on each assertion. `EndUserAuthGuard` now rejects a cookie whose backing
  session is terminated/expired/missing — making logout actually force re-authentication on the next SSO
  despite the stateless cookie. Cookies issued before v1.8.0 (no `sid`) require one re-login after upgrade.
- **Admin Active Sessions page** (`/admin/sessions`, `GET/POST /api/admin/saml-sessions`): list active/terminated
  SSO sessions with status / Service-Provider / search filters and pagination; terminate one session or all
  sessions for a user (`/terminate-by-user`); shows login IP, user-agent, and last-active. Dashboard gains an
  active-SSO-sessions stat.
- **Per-SP `wantLogoutRequestsSigned` flag** and **`sloUrl`** field on SP connections (DTOs, mapper, form),
  plus an **Autofill from SP metadata** affordance (`POST /api/admin/sp-connections/parse-slo-from-metadata`)
  that extracts `SingleLogoutService` Locations from a pasted SP `EntityDescriptor`.
- **LogoutRequest replay protection** (`SamlLogoutRequestLog`, unique request id, recorded only after the
  signature is valid; purged with the clock-skew window), and **per-IP rate limiting** on the public `/saml/slo`
  endpoint (`SamlSloRateLimiterService`).
- **Automatic session termination on user lifecycle:** deactivating or deleting an identity user terminates all
  of that user's active SSO sessions.
- New audit events: `saml_logout_request_received`, `saml_logout_request_rejected`, `saml_logout_completed`,
  `saml_session_terminated`, `saml_sso_session_started`. New `samlSessions` + `loggedOut` i18n namespaces and
  `spConnections.sloUrl` / `wantLogoutRequestsSigned` strings in all 10 locales.
- New shared contracts: `SAML_SLO_PATH`, `SAML_SESSIONS_API_PATH`, `SAML_SESSIONS_ROUTE_PREFIX`,
  `LOGGED_OUT_ROUTE`, SLO status-code constants, `EndUserSessionPayload.sid`, and session/SLO DTOs.
- New `docs/img/slo-flow.mmd` sequence diagram (SP-initiated SLO + admin termination).

### Changed

- `SamlResponseBuilderService.buildLoginResponse` now also returns `sessionIndex`, `nameId`, and `nameIdFormat`.
- `SamlSsoService.completeSso` accepts the SSO-session id, records a participation, and rejects a terminated
  session. `verifyEnvelopedXmlDsig` was extracted into a reusable util. `SamlSessionCleanupService` also purges
  expired SSO sessions and old replay-log rows.
- `SamlSsoSessionService` lives in a dedicated `SamlSessionRegistryModule` imported by the SAML, Auth, and
  Identity-admin modules.

### Security

- SP application sessions are **not** torn down by local invalidation (no back-channel SLO) — documented as an
  explicit limitation in the admin UI. Display-only login IP / user-agent are never used for authorization.

## [1.7.3]

### Fixed

- `express` added as an explicit `dependency` in `apps/api/package.json`. The package was already used
  directly in `main.ts` (`import express from 'express'` for `urlencoded` middleware) but was not listed
  as a direct dependency — it only resolved transitively through `@nestjs/platform-express`. pnpm's strict
  module isolation means transitive packages are not importable unless declared directly, causing
  `Error: Cannot find module 'express'` on production startup inside Docker.

## [1.7.2]

### Added

- **EC IdP encryption key — inbound ECDH-ES decrypt (Prompt 25, Feature 1):**
  `SamlRequestParserService` now decrypts incoming encrypted SAMLRequest payloads when the IdP holds an
  EC encryption key (P-256, P-384, P-521). Decryption uses XML Encryption 1.1 ECDH-ES direct key agreement
  (`xenc11:AgreementMethod`) with ConcatKDF (NIST SP 800-56A §5.8.1, SHA-256) to derive the AES content
  key. Routing between EC and RSA paths is automatic based on the presence of `xenc11:AgreementMethod` in
  the encrypted request XML. Added `decryptXmlEcdhEs()`, `deriveEcdhEsKeyWithConcatKdf()`, and
  `extractEcPublicKeyFromXenc11()` utilities; updated `IdpEncryptionKeyService` with separate
  `getRsaDecryptionMaterial()` and `getEcDecryptionMaterial()` accessors.
- **HTTP-POST SAMLRequest binding (Prompt 25, Feature 2):**
  `POST /saml/sso` now accepts a `SAMLRequest` form field (Base64, no deflate) per the SAML 2.0 HTTP POST
  binding specification. Added `SamlSsoService.handlePostSso()` and `SamlRequestParserService.parsePostBinding()`.
  Enveloped `ds:Signature` inside the `AuthnRequest` XML is verified with `xml-crypto` when the SP
  connection enables `wantAuthnRequestsSigned`. Encrypted POST requests are supported via the same ECDH-ES
  path as Redirect binding. `express.urlencoded()` middleware added to `main.ts` for form body parsing.
- **IdP metadata now includes POST binding SSO endpoint** before the Redirect binding endpoint, per SAML 2.0
  preference ordering. `SingleSignOnService` element added with `Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`.
- **Admin UI — EC key awareness (Prompt 25, Ext-1/2/3):**
  - IdP Settings page shows an informational callout when the active encryption key uses an EC curve,
    explaining ECDH-ES key agreement and SP compatibility considerations.
  - SP Connection Test SSO page shows a warning callout (`ec_key_agreement_sp_compat`) when the IdP
    encryption key is EC and SP encrypted request testing is enabled.
  - Dashboard SP Security panel shows an informational callout (`idpEncryptionKeyIsEc`) when the IdP
    encryption key family is `ec`.
- **Test fixtures:** `createTestIdpSettingsWithEcEncryptionKey()`, `createTestSpConnectionWithEcSigningKey()`,
  `generateTestEcCert()` added to `test-fixtures.ts`.
- Audit service `logRequestReceived()` and `logRequestRejected()` now record `bindingType` (`redirect` or `post`).
- `POST_BINDING_URI` and `REDIRECT_BINDING_URI` constants and `bindingType` field added to
  `ParsedAuthnRequestDto` in `@nestidp/shared`.
- `idpEncryptionKeyIsEc` field added to `AdminDashboardSpSecuritySummaryDto`.
- All 10 locale files include new keys: `idpSettings.encryptionEcKeyAgreementInfo`,
  `spConnections.testSsoEcKeyAgreementWarning`, `dashboard.spSecurity.ecKeyAdvisory`.

### Fixed

- `SpaFallbackController.sendIndex` passes `{ dotfiles: 'allow' }` to `res.sendFile()` so the SPA index
  is served correctly when the project lives under a path that contains hidden directories (e.g. `.claude`
  worktree paths). Express 5 / `send@1.2.1` block dotfile paths by default.
- E2E test `E2E-SAML-03` updated to expect 415 instead of 405 for `POST /saml/sso` without a form body,
  reflecting the real HTTP POST binding endpoint.

## [1.7.1]

### Added

- Admin SP connection form now supports `Require signed AuthnRequest` with certificate gating, operator callouts,
  and a collapsible **Probe SP signing key** panel that verifies private-key/certificate matching via
  `POST /api/admin/sp-connections/:id/probe-sp-signing`.
- IdP settings now expose a SAML behavior toggle for `wantAuthnRequestsSigned` with an operator callout that links
  to SP connections so teams distinguish metadata preference from per-SP enforcement.
- SP Test SSO page now fetches `GET /api/admin/sp-connections/:id/test-sso-url`, supports signed/encrypted toggles,
  renders a copyable URL, and shows warning callouts (including ephemeral signing-key warnings).
- Dashboard now includes an SP security summary panel and warning callout when SP connections enable security flags
  without an SP certificate (`spConnectionsMissingCertWithSecurityFlags > 0`).
- Web admin API client now includes `getSpConnectionTestSsoUrl()` and `probeSpConnectionSigning()` helpers plus
  updated shared DTO support for `wantAuthnRequestsSigned` on SP and IdP settings.

### Changed

- All web locale files now include the new `spConnections.*`, `idpSettings.*`, and `dashboard.spSecurity.*` keys,
  along with audit event labels for `saml_request_signature_verified`, `saml_request_decrypted`,
  `sp_signing_probe_performed`, and `idp_want_authn_requests_signed_updated`.
- Web test fixtures and page/API/i18n coverage were extended with Prompt 24 IDs:
  `WEB-SP-REQ-SIG`, `WEB-IDP-REQ-SIG`, `WEB-SP-TEST-SSO`, and `WEB-DASH-REQ` checks, while keeping i18n key parity green.

## [1.7.0]

### Added

- **Runtime encrypted SAML assertions (Prompt 23):** when `SpConnection.wantAssertionsEncrypted` is true,
  `SamlResponseBuilderService` signs the assertion then wraps it in `saml2:EncryptedAssertion` using
  **AES-256-CBC** content encryption and **RSA-OAEP-MGF1P** key transport to the SP public certificate
  PEM on the connection. IdP encryption metadata cert is not used for outbound assertion encryption.
- `saml-assertion-encryption.util.ts` plus test decrypt helper for round-trip verification.
- Tests: `API-SAML-ENC-01`–`04`, `API-SAML-ENC-UTIL-01`–`04`, `API-IDP-SAML-ENC-02` (full complete-sso).

### Changed

- SP connection i18n `wantAssertionsEncryptedHint` documents runtime behaviour (SP cert PEM, not IdP
  encryption cert).
- [docs/img/idp-certificates.mmd](./docs/img/idp-certificates.mmd), [tutorial.md](./docs/tutorial.md),
  [proposal.MD](./proposal.MD), [README.md](./README.md) — encrypted assertions marked implemented.

## [1.6.0]

### Changed

- **Repository layout:** production source and tests are fully separated across the monorepo.
  API unit/integration specs moved from `apps/api/src/**/*.spec.ts` to `test/unit/**` (mirroring modules);
  shared test helpers live under `test/support/**` (`@api/*`, `@test/*` path aliases). Nest feature code is
  grouped per module (`controllers/`, `services/`, `dto/`, `utils/`, …).
- **Web layout:** Vitest specs under `apps/web/test/unit/**`; `test/setup/` and `test/helpers/paths.ts` for
  filesystem guards. Admin components split into `common/`, `layout/`, `identity/`, `mapping/`, `idp-cert/`,
  `hooks/`; mapping and IdP cert presets moved to colocated `constants.ts` / `enums.ts`.
- **Shared package:** specs under `packages/shared/test/` with `@shared/*` alias.
- [docs/development.md](./docs/development.md) documents the tests-vs-source table and alias conventions.
- Main Vite chunk size budget raised to **700 KB** raw (`scripts/check-web-bundle-size.mjs`) — encryption
  cert admin UI and i18n catalog exceeded the 650 KB cap on current main; locale chunks remain separate.

### Fixed

- Integration test DB setup: cross-worker `sync-prisma-provider` races on macOS (no `flock`) replaced with a
  portable file lock in `test-db.helper.ts`.
- `API-AUDIT-ENC-01` waits for async audit persistence before asserting encryption cert metadata.
- Web static tests: trim unused `@test/helpers/paths` imports; `admin-confirm-static` scans `src/admin` via `webSrc`.
- Playwright IdP settings mocks include encryption DTO fields (page crashed after v1.5.0); signing generate
  button targeted with `.first()` when encryption panel also exposes the same label.

## [1.5.2]

### Changed

- README: place **Certificates and SAML encryption** after **How it fits together** (before Product tour).

## [1.5.1]

### Fixed

- ESLint CI failure: remove unused `flushPromises` from admin change-password integration spec after
  `waitForAuditEvent` polling was introduced.

### Changed

- README opens with an extensive **Certificates and SAML encryption** section (three cert roles, AES-256-CBC,
  links to diagram and tutorial).
- Operator screenshots `idp-settings-signing-and-encryption.png` and `idp-settings-encryption-cert-options.png`
  added to README product tour, [docs/tutorial.md](docs/tutorial.md), and [docs/img/screenshots.md](docs/img/screenshots.md).

## [1.5.0]

### Added

- IdP **encryption certificate** lifecycle parallel to signing: generate (RSA/EC, OpenSSL `keyUsage=keyEncipherment,dataEncipherment`),
  upload, independent dual-cert rotation, `GET /encryption-cert/public-pem`, copy/download public PEM in admin UI.
- Shared `idp-cert-common.ts` (key family, expiry, curves) and `idp-encryption-crypto.ts` (RSA key transport catalog,
  content-encryption constants for Prompt 23, generate DTO defaults).
- `IdpSettings` encryption PEM + encrypted key + crypto metadata (primary and pending); `encryptionRotationStartedAt`
  separate from signing rotation (both may be active concurrently).
- SAML metadata `md:KeyDescriptor use="encryption"` when configured (primary first, pending second during rotation);
  up to four `KeyDescriptor` elements when signing and encryption rotations run together.
- Admin encryption panel on `/admin/settings/idp`: key family, RSA modulus/EC curve, key transport (RSA only), expiry,
  copy signing options, callouts (IdP vs SP cert, EC metadata-only, deprecated RSA-1_5), pending cert during rotation.
- Dashboard encryption summary line and `encryptionCertStatus` (`not_configured` | `ok` | `expiring_soon` | `rotation_active`).
- `SpConnection.wantAssertionsEncrypted` (DB + admin checkbox); API requires **SP certificate** PEM when enabled (not IdP
  encryption cert); runtime encrypted assertions deferred to Prompt 23.
- Audit log human-readable labels for encryption cert and rotation events (all locales).
- Operator diagram [docs/img/idp-certificates.svg](docs/img/idp-certificates.svg) and PostgreSQL smoke
  `API-IDP-PG-ENC-01`.
- Extended tests: `API-IDP-ENC-*`, `API-SAML-META-ENC-*`, `API-SVC-ENC-*`, `API-IDP-SAML-ENC-01`, `WEB-IDP-ENC-*`,
  `E2E-IDP-ENC-01`, `API-SP-ENC-*`.

### Changed

- `IdpSettingsPublicDto` and `AdminDashboardIdpStatusDto` expose encryption fingerprints, crypto fields, and
  `encryptionRotation` block; signing imports refactored to `idp-cert-common` without behaviour change.

## [1.4.7]

### Added

- IdP signing certificate **generate options** in admin: RSA/EC key family, modulus or curve, eight XML-DSig
  signature algorithms, and calendar **expiry date** (UTC, today..10 years) with shared catalog in
  `@nestidp/shared` (`idp-signing-crypto.ts`).
- `IdpSettings` crypto metadata columns (primary + pending rotation): key family, algorithm id, RSA bits, EC curve.
- Pending certificate panel during rotation (algorithm, expiry, fingerprint); dashboard one-line signing summary;
  SP compatibility callouts for EC and SHA-1; metadata preview refresh after generate.
- xml-crypto extensions for RSA-SHA384 and all ECDSA XML-DSig URIs used by the signing catalog (Node `crypto` backends).

### Changed

- `POST /api/admin/idp/settings/signing-cert/generate` and rotation `mode: generate` accept optional JSON body
  (empty `{}` keeps defaults: RSA-2048, rsa-sha256).
- SAML assertion signing uses stored primary `signingSignatureAlgorithmId` (legacy rows fall back to rsa-sha256).
- Lazy auto-generate and default operator generate validity: **730 days** (was 3650 days for silent generate).
- Upload/rotation upload infers and stores crypto metadata from PEM pairs.

### Fixed

- Certificate rotation `complete`/`cancel` now copies or clears pending crypto columns, not only PEM fields.

## [1.4.6]

### Fixed

- `WEB-ADM-21` in `AdminLayout.test.tsx` matches sidebar nav flags: API connections and audit log
  links are not rendered when `SHOW_API_CONNECTIONS_NAV` / `SHOW_AUDIT_LOG_NAV` are false; SP
  connections link assertion retained so CI `pnpm test` passes after the temporary nav hide.

## [1.4.5]

### Added

- Operator [tutorial.md](docs/tutorial.md) with renamed UI screenshots under `docs/img/*.png`
  (admin, IdP settings, API sync, identity lists, SP connections, SAML login).
- Root README product tour (eight presentation snapshots) and [docs/img/screenshots.md](docs/img/screenshots.md) index.

### Changed

- Root [README.md](README.md) reworked as a landing-style overview (hero, features, diagrams, product tour,
  quick start, doc links) while keeping the eight UI snapshots.
- [docs/README.md](docs/README.md) and [docs/img/README.md](docs/img/README.md) updated: release v1.4.5,
  full diagram index including `admin-confirm-dialog` and `identity-list-pagination`.

## [1.4.4]

### Fixed

- Playwright CI: correct API route mocks for IdP cert generate (`/api/admin/idp/settings/signing-cert/generate`)
  and identity sync (`/api/admin/sync/*`); admin-login E2E no longer clears `localStorage` on every
  navigation (`addInitScript`); username fields use `getByRole('textbox')` to avoid checkbox label collision;
  post-login `waitForURL` excludes `/admin/login`; mobile delete-with-drawer uses DOM click on inert main.

## [1.4.3]

### Added

- Evergreen **confirm dialog** (`useConfirm`, `useConfirmAction`, `ConfirmProvider`) replacing
  native `window.confirm` across the admin SPA (11 existing sites plus **full identity sync**).
- **Warning** vs **danger** tones; **type-to-confirm** (`REPLACE` / `COMPLETE`) for signing-cert
  generate, upload, and complete rotation; member **detail** preview on group/role delete; optional
  **audit log** note on destructive and high-risk actions.
- Vitest `WEB-EVG-CONF-*`, `WEB-ADM-CONF-*`, Playwright `WEB-ADM-E2E-CONF-*`; diagram
  `docs/img/admin-confirm-dialog.mmd` / SVG.
- Extended confirm edge tests: provider concurrency, focus restore, body scroll lock,
  type-to-confirm case sensitivity, full page cancel/confirm matrix, member preview overflow,
  modal CSS z-index contracts, E2E Escape/wrong-challenge/sync cancel.

### Changed

- IdP signing certificate and API connection **full sync** actions use in-app modals instead of
  browser confirm dialogs.
- Clipboard copy failure on IdP settings shows a toast instead of `window.prompt`.

### Removed

- All `window.confirm` and `window.prompt` usage under `apps/web/src/admin`.

## [1.4.2]

### Added

- Extended **remember-me** edge coverage: storage/localStorage failures (`WEB-ADM-RM-17`–`22`),
  login page combinations and rate limits (`WEB-ADM-RM-23`–`28`), API coercion (`API-ADM-DTO-RM-05`–`08`,
  `API-ADM-AUTH-31`–`34`, `API-SES-22`–`24`, `API-AUD-ADM-RM-03`–`06`, `API-CTL-12`), Playwright
  `WEB-ADM-E2E-RM-04`–`05`, and `WEB-ADM-103`–`104` / `SH-ADM-07`.

## [1.4.1]

### Added

- **Admin login**: **Remember username** (device `localStorage` only) and **Stay signed in**
  (`rememberMe` → longer session up to 90 days via `ADMIN_SESSION_REMEMBER_TTL_SECONDS`).
  Shared-computer warning, session-expired redirect (`/admin/login?reason=session_expired`),
  audit `metadata.rememberMe` on persistent logins, CI smoke `CI-DCK-02-RM-01`, and Playwright
  `WEB-ADM-E2E-RM-01`–`03`. Vitest `WEB-ADM-RM-*`, `API-ADM-AUTH-24`–`30`, `API-SES-16`–`21`.

### Changed

- Default admin login uses a **browser session cookie** (no `Max-Age`); stay signed in sets
  persistent `Max-Age` aligned with signed payload `exp`. `POST /api/admin/auth/login` accepts
  optional `rememberMe`. Docker dev entrypoint runs `pnpm install` when `pnpm-lock.yaml` changes.

## [1.4.0]

### Added

- **Identity admin lists** (users, groups, roles): TanStack Table v8 with server-side pagination
  (10 rows per page), shared `IdentityListTable` (lazy-loaded chunk), and `useIdentityListQuery`
  (race-safe fetch via request generation, page clamp when `total` shrinks, errors keep the current
  page and last rows). Pagination UI includes i18n Previous/Next, visible range, and `aria-live`
  announcements; groups and roles gain `EmptyState` when `total === 0`. Vitest edge registry
  `WEB-IDN-TBL-01`–`24`, `WEB-IDN-TBL-HK-01`–`10`, `WEB-IDN-TBL-CMP-01`–`11`, `WEB-ADM-100`–`101`;
  Playwright `WEB-IDN-TBL-E2E-01`; diagram `docs/img/identity-list-pagination.mmd`.

### Changed

- Identity browse pages fetch `limit=10` with `offset` instead of 50–100 rows per request;
  `listIdentityUsers` / `listIdentityGroups` / `listIdentityRoles` in `adminApi` default
  `limit` to `IDENTITY_LIST_PAGE_SIZE` from `@nestidp/shared`; groups/roles headers show total
  count like users. TanStack ships in a lazy `IdentityListTable` chunk to keep the main bundle
  under the 650 KB budget. Evergreen `.evg-table-pagination` styles for narrow viewports.

## [1.3.17]

### Changed

- **Admin sync page**: default **dry run** off so a normal “Run sync” writes users, groups, and
  roles to the database; dry run remains available via checkbox for validation only.

## [1.3.16]

### Changed

- **Docker dev** (`docker-compose.dev.yml`): `extra_hosts: localhost:host-gateway` on
  `nestidp-dev` so API connections and sync can use **`http://localhost:4010`** for a mock
  identity API running on the host (no `host.docker.internal` required).

## [1.3.15]

### Fixed

- **Docker dev**: run `prisma generate` after `sync-prisma-provider` in `docker-dev-entrypoint.sh` so the
  API uses a PostgreSQL Prisma client when `DATABASE_URL` is `postgresql://…` (fixes 500 / crash:
  `the URL must start with the protocol file:`). Dev image build now generates the client for
  postgresql instead of default sqlite.

## [1.3.14]

### Fixed

- **`Dockerfile.dev`**: run `pnpm install --ignore-scripts` before copying full source so root
  postinstall does not fail with missing `packages/shared/tsconfig.json` during image build.
- **`.dockerignore`**: exclude `node_modules`, `mock-app`, and build artifacts so dev image
  builds stay fast and context stays small.

## [1.3.13]

### Fixed

- **`docker-compose.dev.yml`**: replaced tab indentation with spaces so `pnpm dev:docker` /
  `dev:docker:down` parse under Docker Compose (same class of error as CI workflow YAML).

## [1.3.12]

### Changed

- **Dev hot reload**: root `pnpm dev` runs `@nestidp/shared` `tsc -w` alongside API and web so
  shared/API changes rebuild without manual steps; API dev uses `run-dev.mjs` with TypeScript
  polling watchers when `CHOKIDAR_USEPOLLING` / Docker dev is active.

## [1.3.11]

### Fixed

- **API connections create**: v1 limit now counts only external connections (`isLocalDirectory:
false`), not the hidden bootstrap **Local directory** row — operators could see an empty list yet
  get "Only one API connection is supported in v1" on first create.

## [1.3.10]

### Fixed

- **`pnpm diagrams:build` on GitHub Actions**: pass Puppeteer `--no-sandbox` (and related flags)
  via `scripts/mermaid-puppeteer-ci.json` when `CI`/`GITHUB_ACTIONS` is set, so mermaid-cli can
  launch Chromium on Ubuntu runners with AppArmor user-namespace restrictions.

## [1.3.9]

### Fixed

- **WEB-RSP-82 / WEB-RSP-83**: stop pinning package version `1.3.4` in Vitest guards — assert semver
  on root and version parity with `@nestidp/web` so CI does not fail on every release bump.

## [1.3.8]

### Fixed

- **PostgreSQL integration tests**: `clearApiConnectionScopedTestData` deletes `SyncLog` (and
  related identity rows) before `ApiConnection`, fixing FK violations when postgres specs share
  the CI database after sync tests.

## [1.3.7]

### Fixed

- **PostgreSQL integration tests on CI**: `runMigrationsOnTestDb` now runs `prisma generate` after
  switching datasource provider; API Jest runs `*.postgres.integration.spec.ts` in a separate process
  with a postgresql client generated before any spec imports `@prisma/client`, fixing
  `the URL must start with the protocol file:` when `POSTGRES_TEST_URL` is set.

## [1.3.6]

### Fixed

- **GitHub Actions**: removed duplicate `pnpm/action-setup` `version: 9` so CI uses
  `packageManager` (`pnpm@9.15.9`) from root `package.json` and avoids
  `ERR_PNPM_BAD_PM_VERSION`. Set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` for the
  Node 20 action-runtime deprecation warning on `checkout` and `pnpm/action-setup`.

## [1.3.5]

### Fixed

- **GitHub Actions** (`.github/workflows/ci.yml`): workflow YAML used tab indentation, which GitHub
  rejects before any job starts — runs showed **Failure** with **no jobs or logs**. Re-indented with
  spaces so **verify** and **docker-smoke** jobs run normally.

## [1.3.4]

### Added

- **Docker dev hot reload**: `Dockerfile.dev`, `docker-compose.dev.yml`, `scripts/docker-dev-entrypoint.sh` —
  **`pnpm dev:docker`** runs PostgreSQL + **Nest `--watch`** + **Vite HMR** on **http://localhost:5173**
  (API on **3000**); bind-mounts source with preserved `node_modules` volumes; file polling for macOS Docker.
- **`apps/api/scripts/run-jest-tests.mjs`**: serial Jest on CI (`--runInBand`) to avoid migration races and flakes.
- **`pnpm --filter @nestidp/web test:e2e:ci`**: Playwright responsive shell smoke without macOS PNG baselines.

### Changed

- **GitHub Actions** (`.github/workflows/ci.yml`): `CI=true` for tests; **`pnpm diagrams:build`** before check;
  visual Evergreen screenshots **skipped on CI**; e2e runs **`test:e2e:ci`** instead of full visual suite.
- **Vite**: `host: true` and optional **polling watch** when `CHOKIDAR_USEPOLLING=true` (Docker dev).

## [1.3.3]

### Added

- **`scripts/cleanup-test-processes.mjs`** and **`scripts/run-monorepo-tests.mjs`**: root `pnpm test` runs
  packages sequentially and kills stale Vitest/Jest/Playwright workers on normal exit, failure, or
  **SIGINT**; **`pnpm test:cleanup`** for manual cleanup after aborted IDE/agent runs.
- **`pretest` / `posttest`** hooks on `@nestidp/web` and `@nestidp/api` invoke the same cleanup script.

### Changed

- Web Vitest: **`maxWorkers: 4`**, fork pool, explicit teardown/hook timeouts.
- API Jest: **`--forceExit`** and capped **`--maxWorkers`** (4 unit, 2 e2e) to reduce hung workers and
  parallel `sync-prisma-provider` races.

## [1.3.2]

### Added

- Extended responsive shell Vitest registry **`WEB-RSP-40`–`115`** and infra **`WEB-EVG-177`**: drawer
  scrim/inert/body-lock edge cases, CSS static guards (breakpoints, z-index, table-wrap order), admin
  page integration inside `AppShell`, and committed screenshot baseline checks.

### Fixed

- Admin shell: left sidebar **stays fixed** on desktop (`≥768px`) while **only** `.evg-main` scrolls;
  shell uses `100vh`/`100dvh` with `overflow: hidden` on the grid so the green nav no longer scrolls away
  on long IdP settings or audit pages.
- Mobile menu burger **visible only below 768px**; toggles off-canvas drawer with scrim, Escape, and nav
  link close; **`inert`** and `aria-hidden` on `#evg-main` while open; **body scroll lock** during open.
- Resize to desktop (`matchMedia` `min-width: 768px`) force-closes drawer and clears body lock.

### Changed

- **`.evg-shell-body`** wrapper in `AppShell`; flex **`min-width: 0`** on shell-body, topbar, and main;
  page header actions stack below **639px**; mobile **toast region** inset below topbar (avoids burger overlap).
- **`.evg-table-wrap`** on API/SP list, audit, admin users, identity group/role detail tables.
- **`.evg-code-block`** `max-width: 100%` for sync log JSON on narrow viewports.
- Vitest **`WEB-RSP-01`–`115`** (core + extended edge: shell behaviour, CSS contracts, admin route
  integration inside `AppShell`, table-wrap guards, Playwright baseline presence); Playwright
  **`e2e/responsive-shell.spec.ts`** (`WEB-RSP-30`–`34`); baseline **`admin-shell-375-drawer-open.png`**;
  infra **`WEB-EVG-174`–`177`**.
- **`docs/development.md`** responsive shell section; **`docs/proposal.MD`** v1.3.2 note; **`docs/img/evergreen-ui.mmd`**
  / SVG shell scroll diagram.

## [1.3.1]

### Added

- Extended i18n Vitest registry **`WEB-I18N-41`–`115`** and **`API-I18N-02`–`05`**: regional browser
  tags, API error slug matrix, enum label coverage, JSON parity failure cases, static admin-page
  guards, cs/sk catalog distinctness, and integration tests across SidebarNav, identity lists, audit,
  API/SP list pages, and sequential `changeLocale` cycling.
- Infra check **`WEB-EVG-173`** asserts extended i18n test files exist.

## [1.3.0]

### Added

- **Web i18n (10 locales):** `en`, `cs`, `sk`, `de`, `fr`, `es`, `pl`, `it`, `pt`, `nl` via **i18next** +
  **react-i18next**; browser language detection with **English fallback**; unsupported tags (e.g. `hu`)
  → `en`; erroneous `cz` → `cs`.
- **`LanguageSelect`** with **Browser default** (clears `localStorage`, re-reads `navigator.languages`),
  native language names, on admin shell, SAML login, and admin login.
- Locale catalogs under **`apps/web/src/i18n/locales/`** (14 namespaces); lazy-loaded JSON chunks per
  locale; English catalog in main bundle for first paint.
- **`formatAdminApiError`** / **`formatAuthApiError`** mapping known API `message` slugs to **`errors`**
  namespace; **`enum-labels.ts`** for audit categories, identity origin filter, SP mapping presets.
- Shared **`@nestidp/shared` i18n constants** (`SUPPORTED_LOCALES`, `LOCALE_STORAGE_KEY`,
  `BROWSER_LOCALE_SENTINEL`); root **`pnpm check:i18n-keys`** script for JSON key parity vs `en.json`.
- Vitest **`WEB-I18N-01`–`40`**, **`API-I18N-01`**; Playwright **`e2e/i18n-login-cs.spec.ts`** (Czech
  login smoke); Vitest setup forces **`en`** for existing admin tests.
- Build scripts: **`scripts/i18n-locale-catalog.mjs`**, **`scripts/build-i18n-locale-json.mjs`**.

### Changed

- All operator-visible admin and login UI strings migrated to translation keys; **`document.documentElement.lang`**
  synced on locale change; **`useAdminDocumentTitle`** uses translated page titles.
- **`docs/development.md`** i18n contributor guide; **`docs/img/evergreen-ui.mmd`** / SVG includes
  i18n layer; **`docs/proposal.MD`** Phase 1 marks Web SPA i18n complete.
- Main Vite chunk budget **650 KB** raw (`scripts/check-web-bundle-size.mjs`) — i18next + English
  catalog in main chunk; per-locale JSON remains async-loaded (fonts excluded).

## [1.2.3]

### Added

- Extended identity UI Vitest registry **`WEB-IDN-UI-25`–`58`**: static guards (no hand-rolled
  `evg-btn` on `Identity*.tsx`, list `evg-inline-form` / `labelVisuallyHidden` contracts), groups
  and roles filter `aria-busy` + disabled controls, combined search+origin refetch, table wraps,
  synced vs manual detail/form `ButtonLink` paths, empty state, API error with filter form intact,
  CSS token and `.evg-inline-form` rules (`identity-ui-edge-extended.test.tsx`).
- **`ButtonLink`** unit tests **`WEB-IDN-UI-53`–`57`** (variants, sizes, `className` merge,
  `evgButtonClasses` parity with `Button`).
- **`IdentitySectionNav`** tests **`WEB-IDN-UI-45`**, **`46`**, **`58`** (current-section link
  omission, `aria-label`, hrefs).

### Changed

- **`docs/development.md`** documents Vitest registry **`WEB-IDN-UI-01`–`58`** across three test
  files.

## [1.2.2]

### Added

- **`ButtonLink`** UI primitive (`variant` / `size` aligned with `Button`) for router navigation CTAs without hand-rolled `evg-btn` classes on `<Link>`.
- **`IdentitySectionNav`** footer component on identity list pages (cross-links between Users, Groups, and Roles via `ButtonLink`).
- Vitest registry **`WEB-IDN-UI-01`–`24`** for inline filter layout, a11y (`role="search"`), loading `aria-busy`, Enter-to-submit, and identity page `ButtonLink` migration.
- Playwright visual baseline **`identity-users-list-1280.png`** and tests **`WEB-EVG-153b`**, **`WEB-EVG-153c`** for groups/roles **Apply** buttons.

### Changed

- Identity list filters: visible **Search** / **Origin** labels, unified **Apply** submit, `--evg-control-height` alignment in `.evg-inline-form`, `evg-field--grow` / `--fixed` widths, mobile stack ≤480px, users callout spacing (`evg-identity-callout`), tables wrapped in `evg-table-wrap`.
- All **`Identity*.tsx`** admin pages use **`ButtonLink`** for primary/secondary/link actions (headers, edit, cancel, back, API connection link).
- **`docs/development.md`** documents inline list filters vs audit `evg-stack inline`; **`docs/img/evergreen-ui.mmd`** / SVG updated for `ButtonLink` and inline form flow.

### Changed

- Main Vite chunk size budget raised to **580 KB** raw (`scripts/check-web-bundle-size.mjs`) — identity admin modules exceed the prior 500 KB cap; fonts remain excluded.

### Fixed

- Uneven filter toolbar on identity users/groups/roles lists (misaligned input/select/button heights and truncated search placeholder).

## [1.2.1]

### Added

- Extended identity manual CRUD test coverage: **`API-IDN-MAN-09`–`15`** (CRUD happy paths),
  **`API-IDN-MAN-38`–`55`** (validation, filters, audit, CSRF, password change, local connection
  guard), **`WEB-IDN-MAN-01`–`19`** (forms, read-only synced UX, delete confirm, aria-busy, list
  filters), plus service unit tests **`API-IDN-SVC-11`–`12`**.

## [1.2.0]

### Added

- **Manual identity CRUD** in admin: create, edit, and delete local users (password + bcrypt,
  group/role membership), groups, and roles under a bootstrap **Local directory** API connection
  (`isLocalDirectory`, hidden from operator API connection list).
- Prisma **`IdentityOrigin`** (`MANUAL` | `SYNCED`) on `User`, `Group`, and `Role`; synced rows
  stay read-only in admin (`403 managed_by_sync`).
- Identity admin REST: `POST` / `PATCH` / `DELETE` on users, groups, roles; `GET` group/role detail
  with members; `origin` list filter; `confirmPassword` on user create; optional `auditLimit` on
  user detail for recent **`identity`** audit events.
- React pages: user/group/role forms and detail views, **`IdentityMembershipPicker`** (client filter,
  100-item cap), users list callout, origin badges/filters, password confirmation on create.
- Audit category **`identity`** (Prisma enum + shared `AUDIT_CATEGORIES`).
- Test registries **`API-IDN-MAN-01`–`37`**, **`API-IDN-MAN-SAML-01`**, **`WEB-IDN-MAN-20`–`28`**,
  **`WEB-EVG-169`–`171`**.

### Changed

- v1 “one API connection” rule counts only **non-local** rows; dashboard and stats exclude local
  directory; identity sync rejects local connection (`400`).
- **Sync isolation**: deactivate/orphan cleanup and upsert skip **`MANUAL`** records; username
  collisions log `manual_conflict` without aborting sync.
- `docs/proposal.MD` §11 identity route tree; `docs/development.md` REST and test tables;
  `docs/database.md` schema notes.

### Fixed

- Nested Prisma transaction when updating manual user memberships (PATCH no longer 500).

## [1.1.4]

### Added

- Extended Evergreen edge-case Vitest registry **`WEB-EVG-109`–`168`**: `Checkbox`/`Fieldset`/`TextInput`
  primitive edges, `AttributeMappingEditor` preset/JSON/disabled paths, admin form save/busy/badge/Panel
  flows (API/SP/IdP/sync/admins/audit/identity/test-SSO/sync-log), and static import guards for migrated
  pages — parity with login `WEB-EVG-24`–`72` depth for operator forms.

### Fixed

- `Checkbox` ignores `onChange` when `disabled` so label clicks cannot toggle state in tests or assistive flows.

## [1.1.3]

### Changed

- Complete Evergreen styling for all admin forms: every operator CRUD/filter page now uses
  `TextInput`, `Button`, `Select`, `TextArea`, `Checkbox`, `Fieldset`, and `Panel` from
  `apps/web/src/ui/` instead of unstyled native HTML controls; form busy/disabled (`fieldset`,
  `aria-busy`) and table row actions (`Button size="sm"`) standardized.

### Added

- `Checkbox`, `Fieldset`, and `TextInput.labelVisuallyHidden` UI primitives with focus-visible
  styles for inputs and checkboxes.
- Vitest registry **`WEB-EVG-73`–`108`**: static guards (no raw controls in admin), colocated
  `*.evergreen-forms.test.tsx` per page, a11y label smoke tests, extended conventions.
- Playwright baselines `api-connection-form-1280.png` and `idp-settings-1280.png`.
- Evergreen UI diagram update (`docs/img/evergreen-ui.mmd`) showing admin form → ui primitive flow.

### Fixed

- Operator perception that “theme is missing” on form pages — design tokens were present since
  1.1.0 but page markup did not use `ui/` components.

## [1.1.2]

### Fixed

- Production SPA routes (`/admin`, `/login`) returned 500 after Evergreen deploy: `ServeStaticModule`
  exclude patterns `/api*` and `/saml*` are invalid under path-to-regexp v8; replaced with named
  wildcards `/api*rest` and `/saml*rest`.

## [1.1.1]

### Added

- Extended Evergreen edge-case Vitest registry **`WEB-EVG-24`–`72`**: UI primitive variants,
  static convention guards (no legacy classes, barrel-only imports), print.css rules, full barrel
  export list, toast queue/dismiss/provider errors, six mutation-flow toast integrations,
  LoginPage SSO/Callout/Spinner states, Dashboard badge mapper edges, and infra baseline checks.

## [1.1.0]

### Added

- **Evergreen design system** for the operator console and SAML login: CSS tokens and layout under
  `apps/web/src/styles/evergreen/`, reusable React primitives in `apps/web/src/ui/` (barrel
  `index.ts`), responsive `AppShell` with mobile drawer, `OperatorSessionBar`, and `ToastProvider`
  for post-save feedback.
- **Self-hosted fonts** (`Source Sans 3`, `IBM Plex Mono` woff2 under `public/fonts/`) with preload
  in `index.html` — no Google Fonts CDN (CSP-friendly Docker deploys).
- **`status-badge.ts`** mappers (`syncLogStatusToBadge`, `lastSyncStatusToBadge`, `certStatusToBadge`)
  so list and dashboard badges stay consistent.
- **`print.css`** for audit-friendly print preview (hides sidebar and topbar).
- Vitest registry **`WEB-EVG-01`–`23`** (primitives, styles, admin/login integration, infra checks).
- Playwright visual baselines (`apps/web/e2e/screenshots/`, four viewports) and CI job
  `test:e2e:visual` with mocked admin API routes.
- **`scripts/check-web-bundle-size.mjs`** — fails CI if main Vite `index-*.js` exceeds **500 KB**
  raw (fonts excluded).
- Diagram `docs/img/evergreen-ui.mmd` / `.svg` and **Evergreen UI** section in `docs/development.md`
  (component chooser table, test commands).

### Changed

- Complete admin SPA and `/login` visual redesign: Evergreen `Card`, `Callout`, `Spinner`, `Table`,
  `Panel`, and form controls; dashboard `StatCard` grid; list pages use scroll-wrapped tables.
- Toasts on successful saves: API/SP connections, IdP settings mutations, identity sync, audit
  export, admin user create/password change.
- `AdminUsersPage` exposes `id="change-password"` panel for operator session deep links.

### Removed

- Legacy monolithic `apps/web/src/index.css` and `admin-*` / `layout` / `card` class palette.

## [1.0.2]

### Fixed

- Docker Compose stack no longer crash-loops on startup: `prisma:prepare` now copies
  provider-specific migration SQL (`migrations-postgresql/` vs `migrations-sqlite/`)
  before `migrate deploy`, fixing P3019 lock mismatch and PostgreSQL `DATETIME` errors.
- Docker image includes `apps/api/scripts/sync-prisma-provider.mjs`; entrypoint runs
  prepare using runtime `DATABASE_PROVIDER` / `DATABASE_URL`.
- `@nestidp/shared` package `exports` now includes `require` so the production API
  (CommonJS) can load the workspace package in the Docker runner.
- SPA fallback (`/admin`, `/login`) resolves `index.html` from `apps/web/dist` instead of
  a non-existent `apps/api/web/dist` path when running from compiled `dist/spa/`.

### Added

- `prisma/migrations-postgresql/` — squashed PostgreSQL migration history for production deploy.

## [1.0.1]

### Added

- Comprehensive v1.0 edge-case test coverage per `prompts/10-v1-release.md` §15 registry:
  audit API (`API-AUD-*` 25+, `API-AUD-EXP-*` 8, `API-AUD-RET-*` 7, `API-AUD-QRY-*` 6),
  admin users (`API-ADM-USR-*` 31, `API-ADM-USR-RL-*` 4 + integration rate-limit),
  change-password (`API-ADM-PWD-*` 10), trust proxy + Helmet (`API-TRUST-*`, `API-HELM-*`),
  env validation (`API-*-ENV-*`), E2E release (`E2E-10-*` 10), web (`WEB-ADM-70`–`99`).
- `http-security.ts` extracted from `main.ts` for testable trust-proxy and Helmet behavior.

### Fixed

- Audit list/export query validation now rejects unknown query params (`forbidNonWhitelisted`).

## [1.0.0]

### Added

- Persistent **`AuditEvent`** model and **`GET /api/admin/audit-events`** with filters and **`GET …/export`** (JSON/CSV, 10k row cap)
- **`AuditRetentionCleanupService`** — `AUDIT_RETENTION_DAYS` (default 90) and `AUDIT_CLEANUP_INTERVAL_MS` purge job
- Dual-write audit persistence for admin/SAML/end-user/sync summary events (stdout retained for log aggregation)
- **`/admin/audit`** React page with export buttons and sync-log deep links
- **`AdminUsersModule`** — **`GET/POST/PATCH/DELETE /api/admin/admin-users`** and **`/admin/settings/admins`** UI
- **`POST /api/admin/auth/change-password`** for self-service operator password change
- Rate limiting on **`POST /api/admin/admin-users`** (`ADMIN_USER_CREATE_RATE_LIMIT_*`)
- Docker **`scripts/docker-entrypoint.sh`** with **`prisma migrate deploy`** and **`MIGRATE_ONLY=1`** init-container mode
- Full **`docker-compose.yml`** stack (`nestidp` + `postgres`, `restart: unless-stopped`, healthchecks)
- **`.env.docker.example`**, **`scripts/ci-docker-smoke.sh`**, CI **`docker-smoke`** job
- **`TRUST_PROXY`** and production **Helmet** security headers (CSP tuned for SAML POST HTML)
- **`docs/integration-api.md`**, **`docs/deployment.md`**, **`docs/RELEASE.md`**
- Dashboard links to audit log and admin accounts (`auditEventsRoute`, `adminUsersRoute`)
- Shared: `audit-events.ts`, `admin-users.ts`, `admin-password-policy.ts`; tests API-AUD-_, API-ADM-USR-_, API-ADM-PWD-_, SH-AUD-_, SH-ADM-USR-\*

### Changed

- Refactored `*AuditService` services to dual-write via **`AuditPersistenceService`**
- **`AdminAuthService.login`** trims username; logs **`admin_login_success`** / **`admin_login_failure`** to audit DB
- **`docker-compose.yml`** — default `docker compose up` runs app + PostgreSQL (breaking: removed `profiles: ['postgres']` only workflow)
- **`Dockerfile`** — OpenSSL + wget in runner, **`ENTRYPOINT`** script, **`HEALTHCHECK`**
- `docs/development.md`, `docs/proposal.MD` §13 Phase 1 complete; §14 Q5 resolved
- Monorepo version **1.0.0**

### Security

- Admin account lifecycle audit trail; cannot delete last admin or self while logged in
- Production weak-password rules on admin create, PATCH password, and change-password
- Audit metadata denylist strips secrets before DB insert

**Tests:** run `pnpm test` after upgrade for current totals (API + web + shared + e2e + optional PostgreSQL smoke).

## [0.9.0]

### Added

- **IdP settings admin API** — `GET/PATCH /api/admin/idp/settings`, cert generate/upload, rotation start/complete/cancel, metadata preview
- **`/admin/settings/idp`** React page — entity ID, default NameID format (metadata only), signing cert fingerprints, rotation wizard with in-page checklist, expiry/stale warnings
- **Dashboard IdP status card** — `AdminDashboardResponseDto.idp` with `certStatus`, link to settings (no extra fetch)
- **Dual-cert rotation** — Prisma columns `pendingSigningCertPem`, `pendingSigningKeyEncrypted`, `rotationStartedAt`; metadata publishes two signing certs during rotation; assertions sign with primary until complete
- **`packages/shared/src/idp-settings.ts`** — DTOs, route/API constants, expiry/stale day thresholds
- **`IdpSettingsModule`** — validators, audit service (`API-IDP-AUDIT-01`…`08`), mapper, integration + SAML regression tests (`API-IDP-ADM-01`…`50`, `API-IDP-SAML-01`…`19`, `API-BST-IDP-01`…`02`, `API-SAML-SIGN-13`…`15`)
- Web tests **`WEB-ADM-39`…`69`**, E2E **`E2E-IDP-09-01`…`05`**, shared **`SH-IDP-*`**, **`SH-ADM-DASH-IDP-*`**

### Changed

- `SamlMetadataService` emits multiple signing `KeyDescriptor` elements during rotation
- `IdpSigningService` — `getMetadataSigningCertificates()`, public `generateKeyPairAndCert()`; skip lazy auto-generate when rotation pending
- `GET /api/admin` includes nested **`idp`** summary (backward-compatible additive field)
- `SpConnectionsService.getMetadataUrl()` delegates to `IdpSettingsService`

### Security

- Admin IdP settings API never returns private keys or full cert PEM in JSON
- CSRF on all IdP settings mutations (`POST` / `PATCH`)

**Tests:** 1303 total via `pnpm test` (1066 API Jest + 36 e2e + 123 web Vitest + 78 shared; PG smoke skipped locally).

## [0.8.0]

### Added

- **Admin console SPA** — dashboard, API connection list/create/edit/sync, sync log detail, SP list/create/edit, Test SSO wizard, identity users/groups/roles browse + user detail
- **Mutating SP admin API** — `POST/PATCH/DELETE /api/admin/sp-connections`, `POST …/:id/test-acs` (CSRF on writes)
- **`GET /api/admin`** — `AdminDashboardResponseDto` (counts, routes, IdP URLs, optional API connection + last sync)
- **Identity admin API** — `GET /api/admin/identity/users`, `users/:id`, `groups`, `roles` (pagination + user search)
- **`assertValidAcsUrl`** in `apps/api/src/common/acs-url.util.ts`; SP attribute mapping + certificate validation
- **`ApiConnectionsAuditService`** / **`SpConnectionsAuditService`** — structured stdout audit on CRUD/test
- Shared: `identity-admin.ts`, SP CRUD DTOs, `AdminDashboardResponseDto`, `SAML_NAME_ID_FORMATS`
- Web: `adminApi` CRUD/dashboard/identity helpers; reusable admin UI components (breadcrumbs, mapping editor, presets, empty/loading/error states)
- Integration tests: `API-SPC-*`, `API-SPC-TACS-*`, `API-IDN-ADM-*`, `API-ADM-DASH-*`, `E2E-ADM-08-*`; web `WEB-ADM-20`…`38`

### Changed

- `GET /api/admin` no longer returns stub `status`/`note` — full dashboard payload for the React home page
- Admin layout: sidebar navigation and nested routes under `/admin/*`
- Docs and diagrams updated for v0.8 operator UI (development guide, routing)

## [0.7.0]

### Added

- **Custom `SamlModule`** — SP-initiated SSO (HTTP-Redirect in, HTTP-POST out)
- **`GET /saml/metadata`** — SAML 2.0 IdP metadata with signing cert, NameID formats, optional AttributeConsumingService
- **`GET /saml/sso`** — parse `SAMLRequest`, create `SamlSession`, redirect to `/login?samlSessionId=`
- **`POST /api/auth/login/complete-sso`** — signed `SAMLResponse` as auto-submit HTML (requires end-user session)
- **`SamlRequestParserService`**, **`SamlResponseBuilderService`**, **`SamlMetadataService`**, **`SamlPostBindingService`**, **`IdpSigningService`**, **`SamlAttributeMapperService`**, **`SamlSsoService`**, **`SamlSessionCleanupService`**, **`SamlAuthAuditService`**
- Read-only admin API: **`GET /api/admin/sp-connections`**, **`GET /api/admin/sp-connections/:id`**, **`GET /api/admin/idp/metadata-url`**
- Shared SAML types/constants in **`packages/shared/src/saml.ts`**; **`readyToComplete`** on session probe
- XML stack: `xmlbuilder2`, `xml-crypto`, `@xmldom/xmldom`, `xpath`
- **`docs/examples/saml-sp-initiated-redirect.mjs`** — manual SP redirect URL builder
- **`verifySamlXmlSignature`** test helper; integration tests with cryptographic signature verification
- Env: **`SAML_ASSERTION_TTL_SECONDS`**, **`SAML_SESSION_TTL_SECONDS`**, **`SAML_CLOCK_SKEW_SECONDS`**, **`SAML_METADATA_INCLUDE_ACS`**, **`SAML_SESSION_CLEANUP_INTERVAL_MS`**
- Web: **`completeSsoLogin`** returns HTML; **`LoginPage`** auto-complete SSO when bound / `readyToComplete`
- **`adminApi`**: `listSpConnections`, `getSpConnection`, `getIdpMetadataUrl`

### Changed

- Lazy auto-generation of IdP signing key when `IdpSettings` cert/key missing (encrypted at rest)
- `SamlSession` deleted after successful complete-sso (one-time assertion delivery)
- SSO diagram and docs updated for full v0.7 flow
- Expanded SAML edge-case tests — **752** total via `pnpm test` (648 API Jest + 29 API e2e + 66 web + shared; 9 PostgreSQL smoke skipped locally)

### Security

- **`complete-sso`** requires **`EndUserAuthGuard`** (no unauthenticated assertion issuance)
- HTML POST binding escapes ACS URL and RelayState; assertion only in base64 hidden field
- SAML audit events omit XML bodies and private keys

## [0.6.0]

### Added

- End-user auth API: **`POST /api/auth/login`**, **`GET /api/auth/me`**, **`GET /api/auth/session`**, **`POST /api/auth/logout`**, **`POST /api/auth/login/complete-sso`** (501 stub)
- **`EndUserSessionService`** — HMAC-signed **`nestidp_user_session`** cookie (separate from admin)
- **`SamlSessionBindService`** + **`SAML_SESSION_BIND_PORT`** for Prompt 07 handoff
- **`EndUserLoginRateLimiterService`** — per-IP and per-username brute-force limits
- **`EndUserAuthAuditService`** — structured login/bind/logout audit logs
- Shared: **`EndUserPublicDto`**, auth DTOs, **`AUTH_API_PATH`**, **`LOGIN_PAGE_ROUTE`**, **`SAML_SESSION_QUERY_PARAM`**
- **`createTestUserWithPassword`** test fixture
- `authApi.ts` + functional **`LoginPage`** with SSO session probe and continue stub
- Env: **`END_USER_SESSION_TTL_SECONDS`**, **`END_USER_LOGIN_RATE_LIMIT_*`**
- Integration, sync→login, E2E, and web tests

### Security

- Timing-safe password verify via shared **`verifyPasswordTimingSafe`**
- Generic **401** for all credential failures (no inactive-account enumeration)
- Never expose **`passwordHash`** in JSON responses

### Changed

- **`AuthModule`** replaces stub with full end-user auth stack
- **`IdentityRepository`** — `findUserByUsername`, `findUserProfileById`
- SSO diagram notes v0.6 (login API) vs v0.7 (SAMLResponse)
- Expanded edge-case tests for v0.6.0 — **790** total tests via `pnpm test` (53 shared + 647 API Jest + 28 API e2e + 62 web; **9** PostgreSQL smoke skipped locally)

## [0.5.0]

### Added

- **`SyncModule`** — v1 identity sync engine (fixed REST contract per proposal §7.2)
- **`POST /api/admin/sync/:connectionId`** — manual sync trigger with optional **`dryRun`**
- **`GET /api/admin/sync/:connectionId/status`** — lightweight sync status for dashboard prep
- **`GET /api/admin/sync/:connectionId/logs`**, **`GET /api/admin/sync/logs/:syncLogId`**
- **`IdentitySyncClientService`** — outbound Bearer-authenticated fetch to external identity API
- External API validators; email normalization; **`SYNC_MAX_USERS_PER_RUN`** safety cap (default 10000)
- **`SyncLogDto.durationMs`** — computed run duration in API responses
- **`IdentityRepository`** upsert/deactivate/orphan cleanup methods
- **`SyncLog`** writes with structured **`errors`** JSON
- Shared DTOs: **`SyncLogDto`**, **`TriggerSyncRequestDto`**, **`SyncStatusResponseDto`**, **`SYNC_API_PATH`**
- `adminApi.ts`: **`triggerIdentitySync`**, **`getSyncStatus`**, **`listSyncLogs`**, **`getSyncLog`**
- Env: **`SYNC_HTTP_TIMEOUT_MS`**, **`SYNC_STALE_RUN_MINUTES`**, **`SYNC_MAX_USERS_PER_RUN`**
- **`docs/examples/mock-identity-api.mjs`** — local mock identity source for dev/CI
- Integration + PostgreSQL smoke + static routing regression tests
- Docs: identity sync semantics, curl examples, upgrade guide from v0.4.0

### Changed

- **`AdminStubResponseDto`** adds **`syncApiPath`**
- **`IdentityRepository`** expanded beyond count-only stubs
- Proposal §13: manual sync + upsert checkboxes checked; §14 Q1/Q2/Q5 documented as resolved
- Expanded edge-case tests for v0.5.0 — **601** total tests (8 PostgreSQL smoke skipped locally)

### Security

- Password hashes stored only as returned by external API; never logged in sync errors
- Sync trigger protected by admin session + CSRF
- Bearer token decrypt only in server-side sync client

## [0.4.0]

### Added

- `EncryptionService` + **`CredentialsEncryptionPort`** — AES-256-GCM for API Bearer tokens at rest (`ENCRYPTION_KEY`)
- `redactBearerToken()` log helper
- `ApiConnectionsModule` — CRUD at **`API_CONNECTIONS_API_PATH`**
- **`POST /api/admin/api-connections/:id/test`** — lightweight connectivity probe (`GET /users?limit=1`)
- `base-url.util.ts` — URL parse, normalize, harden (no embedded credentials)
- `AdminCsrfGuard` + CSRF token in login/me responses; `ADMIN_CSRF_HEADER_NAME` header on mutating admin calls
- Shared DTOs: `ApiConnectionDto`, test response, create/update/list/delete types
- Shared **`API_CONNECTIONS_API_PATH`** constant
- `adminApi.ts` helpers: list/get/create/update/delete/**test** API connections
- v1 enforcement: max one `ApiConnection` per deployment; duplicate `name` guard
- `ParseCuidPipe` for route params
- Integration + PostgreSQL smoke tests; **`API-ADM-08`** stats count wiring
- Diagram `docs/img/api-connection-crud.mmd` + SVG

### Changed

- `AdminLoginResponseDto` / `AdminMeResponseDto` include `csrfToken`
- `AdminStubResponseDto` adds required **`apiConnectionsApiPath`**
- `createTestApiConnection` supports real encryption via optional `bearerToken`
- `GET /api/admin` stub note updated
- `docs/development.md` — full admin route table, curl examples, **Upgrading from v0.3.0**
- `docs/database.md`, README, `.env.example` — encryption + API connection docs
- Proposal §13: split checklist — CRUD checked, sync still open
- **Breaking:** v0.3.0 admin sessions must re-login after upgrade (CSRF in session payload)
- Expanded edge-case tests for v0.4.0 — **492** tests (6 PostgreSQL smoke skipped locally)

### Security

- Bearer tokens encrypted at rest; never returned in API JSON
- CSRF on admin mutating endpoints
- HTTPS-only `baseUrl` in production

## [0.3.0]

### Added

- Admin bootstrap: seed first `AdminUser` from env when table empty; `IdpSettings` singleton from `IDP_BASE_URL`
- `run-bootstrap.ts` shared by API startup and `prisma db seed`
- `admin-auth` module: `POST /api/admin/auth/login|logout`, `GET /api/admin/auth/me`
- Signed HTTP-only session cookie (`nestidp_admin_session`), `AdminAuthGuard`
- `PasswordService` + timing-safe `verifyPasswordTimingSafe` (bcrypt cost 12)
- Production bootstrap guard — rejects weak/default first admin password
- `LoginRateLimiterService` — in-memory brute-force protection on login
- `BCRYPT_COST_FACTOR`, admin auth DTOs, `ApiErrorResponseDto` in `@nestidp/shared`
- `AdminLoginPage` at `/admin/login`, session gate in `AdminLayout`, `adminApi.ts` fetch wrapper
- Stale session invalidation when admin row deleted; cookie cleared on 401 in web
- `createTestAdminUserWithPassword` test fixture
- ER-adjacent diagram `docs/img/admin-auth-flow.mmd` + SVG
- Integration tests: bootstrap (API-BST-\*), admin auth SQLite + PostgreSQL smoke

### Changed

- `GET /api/admin` requires authenticated admin session
- `BootstrapService` performs idempotent seeding on startup
- `.env.example`, README, `docs/database.md`, `docs/development.md` — bootstrap + admin login workflow
- Proposal Phase 1: Admin authentication (local) marked complete
- E2E routing tests expect 401 without session on admin API
- Expanded edge-case tests for v0.3.0 admin auth — **329** tests (5 PostgreSQL smoke skipped locally)

## [0.2.0]

### Added

- Full Prisma schema: ApiConnection, User, Group, Role, UserGroup, UserRole, SpConnection,
  AdminUser, SyncLog, SamlSession, IdpSettings
- Initial migration (`initial_schema`) for SQLite dev default
- `IdentityRepository` / `IdentityService` with entity counts
- `AdminStatsService` — `GET /api/admin` returns `AdminStubResponseDto` with table counts
- Shared schema enums, `PasswordHashAlgorithm` constants, and admin response types
- Integration tests for schema constraints and relations (SQLite + optional PostgreSQL smoke)
- Test fixtures (`test-fixtures.ts`) and `test-db.helper.ts` for migration-backed tests
- `prisma:migrate:deploy`, root `db:migrate` / `db:migrate:deploy` aliases
- Empty `prisma/seed.ts` stub (Prompt 03 — no runtime seeding yet)
- ER diagram `docs/img/schema-entities.mmd` + SVG
- GitHub Actions CI workflow with PostgreSQL service for cross-provider smoke tests

### Changed

- `identity` module wired to Prisma; `AdminModule` imports `IdentityModule`
- `docs/development.md`, `docs/database.md`, `README.md` — migrate workflow, production boot, ER diagram
- `Dockerfile` — comment documenting migrate-before-start
- Proposal Phase 1 checklist: Prisma schema and migrations marked complete
- Fixed `apps/api` `test:e2e` script to use `jest-e2e.config.js`
- Expanded edge-case tests for v0.2.0 data layer — **222** tests (3 PostgreSQL smoke skipped locally)

## [0.1.1]

### Changed

- Database layer is **provider-agnostic**: choose `sqlite` or `postgresql` at deploy time via
  `DATABASE_PROVIDER` + `DATABASE_URL` (validated on startup)
- **Local development default:** SQLite (`file:../data/nestidp.db`) — no Docker required
- `prisma:prepare` syncs `schema.prisma` provider before generate/migrate (Prisma requires a
  fixed provider at client generation time)
- PostgreSQL moved to optional `docker compose --profile postgres`
- Docker build accepts `DATABASE_PROVIDER` and `DATABASE_URL` build-args

### Added

- `docs/database.md` — database selection guide for dev and production
- Shared database types and URL validation in `@nestidp/shared`
- Unit tests for database provider resolution and env validation

## [0.1.0]

### Added

- pnpm monorepo scaffold: `apps/api` (NestJS), `apps/web` (React + Vite), `packages/shared`
- **Prisma** selected as ORM — empty `schema.prisma` (datasource only); domain models deferred
- NestJS stub modules: `admin`, `auth`, `sync`, `identity`, `saml` with explicit controller paths (`/api/admin`, `/api/auth`, `/saml/*`)
- Custom `SamlModule` service stubs (no XML libraries yet): request parser, response builder, metadata, POST binding
- SAML route stubs returning HTTP 501: `GET /saml/metadata`, `GET|POST /saml/sso`
- Health endpoints: `GET /health` (no DB), `GET /ready` (Prisma `SELECT 1` ping)
- Bootstrap placeholder (`BootstrapService`) reading `ADMIN_USERNAME` / `ADMIN_PASSWORD` without seeding
- Production static serving: Nest serves `apps/web/dist`; SPA fallback for `/admin/*` and `/login`
- ESLint + Prettier (tabs), root `pnpm lint`, `pnpm test`, `pnpm dev`, `pnpm build`
- Docker: `docker-compose.yml` (PostgreSQL only), multi-stage `Dockerfile`
- Comprehensive test suite (112 tests): env validation, static assets config, Prisma ping,
  admin/auth/health/SAML controllers and services, SPA fallback (503 vs index.html),
  bootstrap edge cases, shared DTO types, React LoginPage/AdminLayout/App routing
- Extracted `static-assets.config.ts` and `spa-paths.ts` for testable production static serving
- `README.md`, `.env.example`, `docs/development.md`
