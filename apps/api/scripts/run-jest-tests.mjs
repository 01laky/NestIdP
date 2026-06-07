#!/usr/bin/env node
/**
 * Run API Jest suites with CI-safe serial execution and limited parallelism locally.
 * Single database engine: libSQL (SQLite-compatible). Each spec applies the migration history to
 * its own temp file via the in-process migrator — no provider prep, no `prisma migrate deploy`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
const repoRoot = resolve(apiRoot, '../..');

function loadEnvFiles() {
	for (const envPath of [resolve(repoRoot, '.env'), resolve(apiRoot, '.env')]) {
		if (existsSync(envPath)) {
			loadDotenv({ path: envPath });
		}
	}
}

const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const unitWorkers = ci ? ['--runInBand'] : ['--maxWorkers=4'];
const e2eWorkers = ci ? ['--runInBand'] : ['--maxWorkers=2'];

function runJest(extraArgs) {
	const result = spawnSync('pnpm', ['exec', 'jest', '--forceExit', ...extraArgs], {
		stdio: 'inherit',
		shell: true,
		cwd: apiRoot,
	});
	return result.status ?? 1;
}

loadEnvFiles();

const unitStatus = runJest([...unitWorkers]);
if (unitStatus !== 0) {
	process.exit(unitStatus);
}

const e2eStatus = runJest(['--config', './test/jest-e2e.config.js', ...e2eWorkers]);
process.exit(e2eStatus);
