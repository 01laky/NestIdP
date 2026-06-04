# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
