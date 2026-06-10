#!/usr/bin/env node
/**
 * §19 typed-config ratchet: raw `configService.get(` reads must not RE-scatter across the api.
 *
 * Env parsing is being consolidated behind the shared helpers (§6.1 boundedInt /
 * positiveIntOrDefault / parseBoolEnv) and the `*Config` provider files. This check freezes the
 * current set of files that read ConfigService directly:
 *  - a file NOT on the allowlist that gains `configService.get(` fails the check (new scatter);
 *  - an allowlisted file that no longer reads ConfigService fails too, so the list can only
 *    shrink (remove the entry in the same commit — the ratchet tightens).
 *
 * Config provider files (*.config.ts / *config.service.ts), main.ts and env validation are exempt
 * from the freeze — they are the intended home for env reads.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const API_SRC = join(process.cwd(), 'apps/api/src');
const PATTERN = /configService\.get\s*[<(]/;

/** Files that may always read ConfigService (the intended home for env parsing). */
const EXEMPT = [
	/(^|\/)main\.ts$/,
	/(^|\/)env\.validation\.ts$/,
	/\.config\.ts$/,
	/config\.service\.ts$/,
	/(^|\/)config\//,
];

/**
 * Frozen legacy direct readers (relative to apps/api/src). Do NOT add to this list — route new
 * env knobs through a *Config provider (or the shared §6.1 parse helpers inside one). Remove an
 * entry when you migrate its file.
 */
const ALLOWLIST = new Set([
	'admin-auth/services/admin-auth.service.ts',
	'admin-auth/services/admin-session.service.ts',
	'admin-users/services/admin-user-create-rate-limiter.service.ts',
	'admin-users/services/admin-users.service.ts',
	'admin/services/admin-dashboard.service.ts',
	'api-connections/services/api-connections.service.ts',
	'audit/services/audit-retention-cleanup.service.ts',
	'auth-protection/lockout-prune.service.ts',
	'auth/services/end-user-session.service.ts',
	'bootstrap/services/bootstrap.service.ts',
	'common/utils/http-security.ts',
	'encryption/services/encryption.service.ts',
	'health/controllers/health.controller.ts',
	'health/services/health.service.ts',
	'idp-settings/services/cert-rotation-scheduler.service.ts',
	'idp-settings/services/idp-settings.service.ts',
	'saml/controllers/saml.controller.ts',
	'saml/services/backchannel-logout-scheduler.service.ts',
	'saml/services/saml-logout.service.ts',
	'saml/services/saml-metadata.service.ts',
	'saml/services/saml-request-parser.service.ts',
	'saml/services/saml-response-builder.service.ts',
	'saml/services/saml-session-cleanup.service.ts',
	'saml/services/saml-slo-rate-limiter.service.ts',
	'saml/services/saml-sso.service.ts',
	'sp-connections/services/sp-connection-test-acs.service.ts',
	'sp-connections/services/sp-connection-test-sso-url.service.ts',
	'sp-connections/services/sp-connections.service.ts',
	'sync/services/identity-sync-client.service.ts',
	'sync/services/oauth-token.service.ts',
	'sync/services/proxy-dispatcher.service.ts',
	'sync/services/sync-scheduler.service.ts',
]);

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			yield* walk(path);
		} else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
			yield path;
		}
	}
}

const offenders = [];
const seen = new Set();
for (const path of walk(API_SRC)) {
	const rel = relative(API_SRC, path).split(sep).join('/');
	const reads = PATTERN.test(readFileSync(path, 'utf8'));
	if (!reads) {
		continue;
	}
	seen.add(rel);
	if (EXEMPT.some((re) => re.test(rel))) {
		continue;
	}
	if (!ALLOWLIST.has(rel)) {
		offenders.push(
			`${rel}: new direct configService.get( read — use a *Config provider (see scripts/check-config-access.mjs)`,
		);
	}
}
for (const rel of ALLOWLIST) {
	if (!seen.has(rel)) {
		offenders.push(
			`${rel}: allowlisted but no longer reads ConfigService — remove it from the allowlist (ratchet down)`,
		);
	}
}

if (offenders.length > 0) {
	console.error('check-config-access: FAILED');
	for (const o of offenders) {
		console.error(`  - ${o}`);
	}
	process.exit(1);
}
console.log(`check-config-access: OK (${seen.size} reader files, ${ALLOWLIST.size} frozen)`);
