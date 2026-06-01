import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const imgDir = join(root, 'docs/img');

const diagrams = readdirSync(imgDir)
	.filter((name) => name.endsWith('.mmd'))
	.sort();

const errors = [];

for (const name of diagrams) {
	const mmd = join(imgDir, name);
	const svg = join(imgDir, name.replace(/\.mmd$/, '.svg'));
	if (!existsSync(svg)) {
		errors.push(
			`missing SVG: docs/img/${name.replace(/\.mmd$/, '.svg')} — run pnpm diagrams:build`,
		);
		continue;
	}
	if (statSync(svg).mtimeMs < statSync(mmd).mtimeMs) {
		errors.push(`stale SVG for ${name} — run pnpm diagrams:build`);
	}
}

if (errors.length > 0) {
	for (const e of errors) console.error(e);
	process.exit(1);
}

console.log(`OK: ${diagrams.length} diagram SVG(s) present and up to date`);
