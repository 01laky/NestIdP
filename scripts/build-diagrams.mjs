#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = join(rootDir, 'docs/img');
const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const puppeteerConfig = join(rootDir, 'scripts/mermaid-puppeteer-ci.json');

const diagrams = readdirSync(imgDir)
	.filter((name) => name.endsWith('.mmd'))
	.sort();

if (diagrams.length === 0) {
	console.error('No .mmd files found in docs/img/');
	process.exit(1);
}

for (const name of diagrams) {
	const input = join(imgDir, name);
	const output = join(imgDir, name.replace(/\.mmd$/, '.svg'));
	console.log(`render ${name} → ${name.replace(/\.mmd$/, '.svg')}`);
	const mmdcArgs = [
		'--yes',
		'@mermaid-js/mermaid-cli',
		'-i',
		input,
		'-o',
		output,
		'-b',
		'transparent',
	];
	if (ci) {
		mmdcArgs.push('-p', puppeteerConfig);
	}
	execFileSync('npx', mmdcArgs, { cwd: rootDir, stdio: 'inherit' });
}

console.log(`OK: ${diagrams.length} diagram(s) rendered`);
