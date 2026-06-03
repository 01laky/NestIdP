#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllLocales } from './i18n-locale-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/web/src/i18n/locales');

mkdirSync(outDir, { recursive: true });

const locales = getAllLocales();

for (const [code, data] of Object.entries(locales)) {
	writeFileSync(join(outDir, `${code}.json`), `${JSON.stringify(data, null, '\t')}\n`);
}

console.log(`Wrote ${Object.keys(locales).length} locale files to ${outDir}`);
