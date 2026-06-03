#!/usr/bin/env node
/**
 * Run API Jest suites with CI-safe serial execution and limited parallelism locally.
 * PostgreSQL integration specs run in a separate Jest process after prisma generate
 * for postgresql, so @prisma/client is not loaded as sqlite first in the same worker.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(__dirname, '..');
const repoRoot = resolve(apiRoot, '../..');

const POSTGRES_INTEGRATION_PATTERN = String.raw`\.postgres\.integration\.spec\.ts$`;

function loadEnvFiles() {
	for (const envPath of [resolve(repoRoot, '.env'), resolve(apiRoot, '.env')]) {
		if (existsSync(envPath)) {
			loadDotenv({ path: envPath });
		}
	}
}

function preparePrismaProvider(provider, databaseUrl) {
	const env = {
		...process.env,
		DATABASE_PROVIDER: provider,
		DATABASE_URL: databaseUrl,
	};
	execFileSync('node', ['scripts/sync-prisma-provider.mjs'], {
		cwd: apiRoot,
		env,
		stdio: 'pipe',
	});
	execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
		cwd: apiRoot,
		env,
		stdio: 'pipe',
	});
	execFileSync('npx', ['prisma', 'generate'], {
		cwd: apiRoot,
		env,
		stdio: 'pipe',
	});
}

const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const unitWorkers = ci ? ['--runInBand'] : ['--maxWorkers=4'];
const e2eWorkers = ci ? ['--runInBand'] : ['--maxWorkers=2'];
const ignorePostgres = ['--testPathIgnorePatterns', POSTGRES_INTEGRATION_PATTERN];

function runJest(extraArgs) {
	const result = spawnSync('pnpm', ['exec', 'jest', '--forceExit', ...extraArgs], {
		stdio: 'inherit',
		shell: true,
		cwd: apiRoot,
	});
	return result.status ?? 1;
}

loadEnvFiles();

const unitStatus = runJest([...unitWorkers, ...ignorePostgres]);
if (unitStatus !== 0) {
	process.exit(unitStatus);
}

const postgresTestUrl = process.env.POSTGRES_TEST_URL;
if (postgresTestUrl) {
	preparePrismaProvider('postgresql', postgresTestUrl);
	const pgStatus = runJest([
		...unitWorkers,
		'--testPathPattern',
		POSTGRES_INTEGRATION_PATTERN,
	]);
	if (pgStatus !== 0) {
		process.exit(pgStatus);
	}

	const sqliteUrl = process.env.DATABASE_URL ?? 'file:../data/nestidp.db';
	preparePrismaProvider('sqlite', sqliteUrl);
}

const e2eStatus = runJest(['--config', './test/jest-e2e.config.js', ...e2eWorkers]);
process.exit(e2eStatus);
