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

// The external identity-store specs use PGlite (in-process Postgres), which loads its WASM via dynamic
// import() — Node's VM needs --experimental-vm-modules for that. That flag slows every other suite, so
// it is applied ONLY to the PGlite phase; the rest run without it.
const EXTERNAL_STORE_PATH = 'test/unit/identity/store/';

function runJest(extraArgs, { vmModules = false } = {}) {
	const nodeOptions = vmModules
		? [process.env.NODE_OPTIONS, '--experimental-vm-modules'].filter(Boolean).join(' ')
		: process.env.NODE_OPTIONS;
	const result = spawnSync('pnpm', ['exec', 'jest', '--forceExit', ...extraArgs], {
		stdio: 'inherit',
		shell: true,
		cwd: apiRoot,
		env: { ...process.env, ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}) },
	});
	return result.status ?? 1;
}

loadEnvFiles();

// Phase 1: all unit suites except the PGlite external-store specs.
const unitStatus = runJest([...unitWorkers, '--testPathIgnorePatterns', '/node_modules/', EXTERNAL_STORE_PATH]);
if (unitStatus !== 0) {
	process.exit(unitStatus);
}

// Phase 2: the PGlite external-store specs, with --experimental-vm-modules.
const externalStatus = runJest([...unitWorkers, EXTERNAL_STORE_PATH], { vmModules: true });
if (externalStatus !== 0) {
	process.exit(externalStatus);
}

// Phase 3: e2e (no PGlite).
const e2eStatus = runJest(['--config', './test/jest-e2e.config.js', ...e2eWorkers]);
process.exit(e2eStatus);
