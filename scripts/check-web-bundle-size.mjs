#!/usr/bin/env node
/**
 * Enforces max raw size of the main Vite JS chunk after web build.
 * Fonts (woff2) are excluded from this budget.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Monolith SPA + i18next (en catalog in main chunk); locale JSON lazy-loaded — raised in 1.3.0. */
const BUDGET_BYTES = 650 * 1024;
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

process.exit(0);
