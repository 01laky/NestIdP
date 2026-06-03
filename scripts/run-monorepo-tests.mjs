#!/usr/bin/env node
/**
 * Run monorepo tests sequentially and always clean up Vitest/Jest workers on exit.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupTestProcesses } from './cleanup-test-processes.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let shuttingDown = false;

function shutdown(code) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	cleanupTestProcesses({ quiet: true });
	process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(sig, () => {
		const base = sig === 'SIGINT' ? 130 : 143;
		shutdown(base);
	});
}
process.on('exit', () => {
	if (!shuttingDown) {
		cleanupTestProcesses({ quiet: true });
	}
});

const suites = [
	['shared', ['pnpm', '--filter', '@nestidp/shared', 'test']],
	['api', ['pnpm', '--filter', '@nestidp/api', 'test']],
	['web', ['pnpm', '--filter', '@nestidp/web', 'test']],
];

cleanupTestProcesses();
let failed = false;

for (const [name, args] of suites) {
	const result = spawnSync(args[0], args.slice(1), {
		cwd: repoRoot,
		stdio: 'inherit',
		env: { ...process.env, NESTIDP_TEST_RUN: '1' },
	});
	cleanupTestProcesses({ quiet: true });
	if (result.status !== 0) {
		console.error(`[nestidp] ${name} tests failed (exit ${result.status ?? 1})`);
		failed = true;
		break;
	}
}

cleanupTestProcesses();
process.exit(failed ? 1 : 0);
