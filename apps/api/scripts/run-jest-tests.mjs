#!/usr/bin/env node
/**
 * Run API Jest suites with CI-safe serial execution and limited parallelism locally.
 */
import { spawnSync } from 'node:child_process';

const ci = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const unitWorkers = ci ? ['--runInBand'] : ['--maxWorkers=4'];
const e2eWorkers = ci ? ['--runInBand'] : ['--maxWorkers=2'];

function runJest(extraArgs) {
	const result = spawnSync('pnpm', ['exec', 'jest', '--forceExit', ...extraArgs], {
		stdio: 'inherit',
		shell: true,
	});
	return result.status ?? 1;
}

const unitStatus = runJest(unitWorkers);
if (unitStatus !== 0) {
	process.exit(unitStatus);
}

const e2eStatus = runJest(['--config', './test/jest-e2e.config.js', ...e2eWorkers]);
process.exit(e2eStatus);
