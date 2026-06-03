#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const localesDir = join(process.cwd(), 'apps/web/src/i18n/locales');
const enPath = join(localesDir, 'en.json');

function collectKeyPaths(value, prefix = '') {
	const paths = [];
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value)) {
			const next = prefix ? `${prefix}.${key}` : key;
			if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
				paths.push(...collectKeyPaths(child, next));
			} else {
				paths.push(next);
			}
		}
	}
	return paths.sort();
}

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const enPaths = new Set(collectKeyPaths(en));

let failed = false;

for (const file of readdirSync(localesDir).filter((name) => name.endsWith('.json') && name !== 'en.json')) {
	const data = JSON.parse(readFileSync(join(localesDir, file), 'utf8'));
	const paths = new Set(collectKeyPaths(data));
	for (const key of enPaths) {
		if (!paths.has(key)) {
			console.error(`${file}: missing key ${key}`);
			failed = true;
		}
	}
	for (const key of paths) {
		if (!enPaths.has(key)) {
			console.error(`${file}: extra key ${key}`);
			failed = true;
		}
	}
}

if (failed) {
	process.exit(1);
}

console.log(`i18n key parity OK (${enPaths.size} keys, ${readdirSync(localesDir).length - 1} locale files)`);
