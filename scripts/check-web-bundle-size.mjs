#!/usr/bin/env node
/**
 * Enforces max raw size of the main Vite JS chunk after web build,
 * and (§19) that server-only dependencies do not leak into ANY SPA chunk.
 * Fonts (woff2) are excluded from the size budget.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Monolith SPA + i18next (en catalog in main chunk); locale JSON lazy-loaded. */
const BUDGET_BYTES = 700 * 1024;
const distAssets = join(process.cwd(), 'apps/web/dist/assets');

function findLargestIndexJs(dir) {
	let best = null;
	let bestSize = 0;
	for (const name of readdirSync(dir)) {
		if (!name.startsWith('index-') || !name.endsWith('.js')) {
			continue;
		}
		const path = join(dir, name);
		const size = statSync(path).size;
		if (size > bestSize) {
			bestSize = size;
			best = path;
		}
	}
	return best ? { path: best, size: bestSize } : null;
}

const largest = findLargestIndexJs(distAssets);
if (!largest) {
	console.error(`check-web-bundle-size: no index-*.js under ${distAssets}`);
	console.error('Run pnpm --filter @nestidp/web build first.');
	process.exit(1);
}

const kb = (largest.size / 1024).toFixed(1);
console.log(`Web main chunk: ${largest.path} (${kb} KB, budget ${BUDGET_BYTES / 1024} KB)`);

if (largest.size > BUDGET_BYTES) {
	console.error(
		`Bundle exceeds budget: ${largest.size} bytes > ${BUDGET_BYTES} bytes (${BUDGET_BYTES / 1024} KB)`,
	);
	process.exit(1);
}

// §19 bundle hygiene: server-only deps must not appear in any SPA chunk. Markers are distinctive
// literals from each dependency's source (package names are mangled away by minification).
// NOTE: cron-parser is deliberately NOT on this list — it is a legitimate CLIENT dependency too:
// the admin ScheduleSection uses @nestidp/shared's validateCronSchedule/nextCronRuns for
// client-side cron validation and the "next runs" preview (Prompt 32). Its ~30 KB is inside the
// 700 KB budget above.
const SERVER_ONLY_MARKERS = [
	// @prisma/client is api-only.
	{ dep: '@prisma/client', marker: 'PrismaClientKnownRequestError' },
	// @libsql/client is api-only (local DB driver).
	{ dep: '@libsql/client', marker: 'SQLITE_BUSY' },
	// xmlbuilder2 is api-only (SAML XML construction).
	{ dep: 'xmlbuilder2', marker: 'An attribute can only be assigned to an element node.' },
];

let leaked = false;
for (const name of readdirSync(distAssets)) {
	if (!name.endsWith('.js')) {
		continue;
	}
	const content = readFileSync(join(distAssets, name), 'utf8');
	for (const { dep, marker } of SERVER_ONLY_MARKERS) {
		if (content.includes(marker)) {
			console.error(
				`Bundle hygiene: server-only dependency "${dep}" leaked into SPA chunk ${name} (marker: ${JSON.stringify(marker)})`,
			);
			leaked = true;
		}
	}
}
if (leaked) {
	process.exit(1);
}
console.log('Bundle hygiene: no server-only dependency markers found in SPA chunks.');

process.exit(0);
